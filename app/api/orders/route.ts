import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createHmac, timingSafeEqual } from "crypto";

type RecipeUnit = "ml" | "un" | "dash" | "drop";
type PricingModel = "by_ml" | "by_bottle" | "by_unit";
type PublicMenuDrinkPriceMode = "markup" | "cmv" | "manual";
type RoundingMode = "none" | "end_90" | "end_00" | "end_50";
type OrderStatus = "pendente" | "em_progresso" | "concluido";
type OrderSource = "mesa_qr" | "balcao";

type Ingredient = {
  id: string;
  name?: string;
  pricingModel: PricingModel;
  costPerMl?: number;
  bottlePrice?: number;
  bottleMl?: number;
  yieldMl?: number;
  lossPct?: number;
  costPerUnit?: number;
};

type RecipeItem = {
  ingredientId: string;
  qty: number;
  unit: RecipeUnit;
};

type Drink = {
  id: string;
  name: string;
  items: RecipeItem[];
  showOnPublicMenu?: boolean;
  publicMenuPriceMode?: PublicMenuDrinkPriceMode;
  manualPublicPrice?: number;
};

type Settings = {
  markup: number;
  targetCmv: number;
  dashMl: number;
  dropMl: number;
  roundingMode: RoundingMode;
};

type AppStatePayload = {
  ingredients?: Ingredient[];
  drinks?: Drink[];
  settings?: Partial<Settings>;
};

type CreateOrderBody = {
  items?: Array<{ drinkId?: string; qty?: number; notes?: string }>;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  tableCode?: string;
  tableToken?: string;
};

type OrderRow = {
  id: string;
  code: string;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  status: OrderStatus;
  source?: OrderSource | null;
  table_code?: string | null;
  subtotal: number;
  created_at: string;
  updated_at: string;
};

type OrderItemRow = {
  order_id: string;
  drink_name: string;
  qty: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
};

const DEFAULT_SETTINGS: Settings = {
  markup: 4,
  targetCmv: 0.2,
  dashMl: 0.9,
  dropMl: 0.05,
  roundingMode: "end_90",
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function applyPsychRounding(price: number, mode: RoundingMode) {
  if (!Number.isFinite(price)) return 0;
  if (mode === "none") return price;

  const integer = Math.floor(price);
  const frac = price - integer;

  if (mode === "end_00") {
    return frac === 0 ? price : integer + 1;
  }

  const targetFrac = mode === "end_90" ? 0.9 : 0.5;
  const candidate = integer + targetFrac;
  if (price <= candidate + 1e-9) return candidate;
  return integer + 1 + targetFrac;
}

function computeCostPerMl(ing: Ingredient): number | null {
  if (ing.pricingModel === "by_ml") {
    const v = ing.costPerMl ?? 0;
    return v > 0 ? v : 0;
  }
  if (ing.pricingModel === "by_bottle") {
    const price = ing.bottlePrice ?? 0;
    const bottleMl = ing.bottleMl ?? 0;
    const yieldMl = ing.yieldMl ?? bottleMl;
    const lossPct = clamp(ing.lossPct ?? 0, 0, 100);

    const effectiveYield = yieldMl * (1 - lossPct / 100);
    if (price <= 0 || effectiveYield <= 0) return 0;
    return price / effectiveYield;
  }
  return null;
}

function computeItemCost(item: RecipeItem, ing: Ingredient | undefined, settings: Settings): number {
  if (!ing) return 0;

  if (item.unit === "un") {
    const cpu = ing.pricingModel === "by_unit" ? (ing.costPerUnit ?? 0) : 0;
    return item.qty * cpu;
  }

  const ml =
    item.unit === "ml"
      ? item.qty
      : item.unit === "dash"
      ? item.qty * settings.dashMl
      : item.qty * settings.dropMl;

  const cpm = computeCostPerMl(ing);
  if (cpm === null) return 0;
  return ml * cpm;
}

function computeDrinkCost(drink: Drink, ingredients: Ingredient[], settings: Settings) {
  const map = new Map(ingredients.map((i) => [i.id, i]));
  let total = 0;
  for (const item of drink.items) {
    total += computeItemCost(item, map.get(item.ingredientId), settings);
  }
  return total;
}

function getFinalDrinkPrice(drink: Drink, ingredients: Ingredient[], settings: Settings) {
  const cost = computeDrinkCost(drink, ingredients, settings);
  const markup = applyPsychRounding(cost * settings.markup, settings.roundingMode);
  const cmv = settings.targetCmv > 0 ? applyPsychRounding(cost / settings.targetCmv, settings.roundingMode) : 0;

  if (drink.publicMenuPriceMode === "manual") return Math.max(0, Number(drink.manualPublicPrice ?? 0));
  if (drink.publicMenuPriceMode === "cmv") return cmv;
  return markup;
}

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

function sanitizeText(value: unknown, maxLen: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function normalizeTableCode(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!cleaned) return null;
  if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(cleaned)) return null;
  return cleaned;
}

function makeTableSignature(tableCode: string, secret: string) {
  return createHmac("sha256", secret).update(tableCode).digest("hex");
}

function isValidTableSignature(tableCode: string, token: string, secret: string) {
  const expected = makeTableSignature(tableCode, secret);
  const expectedBuf = Buffer.from(expected, "hex");
  const tokenBuf = Buffer.from(token, "hex");
  if (expectedBuf.length !== tokenBuf.length) return false;
  return timingSafeEqual(expectedBuf, tokenBuf);
}

function resolveOrderSource(body: CreateOrderBody) {
  const tableCode = normalizeTableCode(body.tableCode);
  if (!tableCode) {
    return { source: "balcao" as const, tableCode: null };
  }

  const secret = process.env.TABLE_QR_SIGNING_SECRET?.trim();
  if (!secret) {
    return { source: "mesa_qr" as const, tableCode };
  }

  const token = typeof body.tableToken === "string" ? body.tableToken.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return { source: "balcao" as const, tableCode: null };
  }

  const valid = isValidTableSignature(tableCode, token, secret);
  if (!valid) {
    return { source: "balcao" as const, tableCode: null };
  }

  return { source: "mesa_qr" as const, tableCode };
}

function makeOrderCode() {
  const now = new Date();
  const y = now.getFullYear().toString();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DRK-${y}${m}${d}-${rand}`;
}

function readCookies(request: Request) {
  const raw = request.headers.get("cookie") ?? "";
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf("=");
      if (idx < 0) return { name: pair, value: "" };
      return { name: pair.slice(0, idx), value: decodeURIComponent(pair.slice(idx + 1)) };
    });
}

async function requireAdminUser(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return { error: NextResponse.json({ error: "Ambiente incompleto para autenticação do admin." }, { status: 500 }) };
  }

  const cookieStore = readCookies(request);
  const supabaseAuth = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore;
      },
      setAll() {
        // route handler não precisa mutar cookie nesse fluxo
      },
    },
  });

  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) };
  }

  return { user };
}

export const dynamic = "force-dynamic";
const ORDERS_API_DEBUG_VERSION = "orders-api-v2026-02-25-origin";

export async function GET(request: Request) {
  const auth = await requireAdminUser(request);
  if (auth.error) return auth.error;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Ambiente incompleto: configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const requestUrl = new URL(request.url);
  const statusParam = requestUrl.searchParams.get("status");
  const sinceParam = requestUrl.searchParams.get("since");
  const statusFilter: OrderStatus | null =
    statusParam === "pendente" || statusParam === "em_progresso" || statusParam === "concluido" ? statusParam : null;
  const since = sinceParam ? new Date(sinceParam) : null;

  let latestOrderQuery = supabase
    .from("orders")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (statusFilter) {
    latestOrderQuery = latestOrderQuery.eq("status", statusFilter);
  }

  const { data: latestOrderData, error: latestOrderError } = await latestOrderQuery.maybeSingle<{ updated_at: string }>();

  if (latestOrderError) {
    return NextResponse.json({ error: "Falha ao verificar atualizações de pedidos." }, { status: 500 });
  }

  const updatedAt = latestOrderData?.updated_at ?? null;
  const sinceTs = since && Number.isFinite(since.getTime()) ? since.getTime() : null;
  const updatedAtTs = updatedAt ? new Date(updatedAt).getTime() : null;
  if (sinceTs !== null && updatedAtTs !== null && updatedAtTs <= sinceTs) {
    return new NextResponse(null, { status: 304 });
  }

  let ordersQuery = supabase
    .from("orders")
    .select("id, code, customer_name, customer_phone, notes, status, source, table_code, subtotal, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (statusFilter) {
    ordersQuery = ordersQuery.eq("status", statusFilter);
  }

  let { data: ordersData, error: ordersError } = await ordersQuery;

  if (ordersError && (ordersError.message.toLowerCase().includes("source") || ordersError.message.toLowerCase().includes("table_code"))) {
    const fallback = await supabase
      .from("orders")
      .select("id, code, customer_name, customer_phone, notes, status, subtotal, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(200);
    ordersData = fallback.data;
    ordersError = fallback.error;
  }

  if (ordersError) {
    return NextResponse.json({ error: "Falha ao listar pedidos." }, { status: 500 });
  }

  const orders = (ordersData ?? []) as OrderRow[];
  if (!orders.length) {
    return NextResponse.json({ orders: [], updatedAt, debugVersion: ORDERS_API_DEBUG_VERSION });
  }

  const orderIds = orders.map((order) => order.id);
  let { data: itemsData, error: itemsError } = await supabase
    .from("order_items")
    .select("order_id, drink_name, qty, unit_price, line_total, notes")
    .in("order_id", orderIds)
    .order("created_at", { ascending: true });

  if (itemsError && itemsError.message.toLowerCase().includes("notes")) {
    const fallback = await supabase
      .from("order_items")
      .select("order_id, drink_name, qty, unit_price, line_total")
      .in("order_id", orderIds)
      .order("created_at", { ascending: true });

    itemsData = (fallback.data ?? []).map((item) => ({ ...item, notes: null }));
    itemsError = fallback.error;
  }

  if (itemsError) {
    return NextResponse.json({ error: "Falha ao listar itens de pedidos." }, { status: 500 });
  }

  const itemsByOrderId = new Map<string, OrderItemRow[]>();
  for (const item of (itemsData ?? []) as OrderItemRow[]) {
    const list = itemsByOrderId.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrderId.set(item.order_id, list);
  }

  return NextResponse.json({
    debugVersion: ORDERS_API_DEBUG_VERSION,
    updatedAt,
    orders: orders.map((order) => ({
      id: order.id,
      code: order.code,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      notes: order.notes,
      status: order.status,
      source: order.source === "mesa_qr" ? "mesa_qr" : "balcao",
      tableCode: order.source === "mesa_qr" ? order.table_code ?? null : null,
      subtotal: order.subtotal,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      items: (itemsByOrderId.get(order.id) ?? []).map((item) => ({
        drinkName: item.drink_name,
        qty: item.qty,
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
        notes: item.notes,
        drinkNotes: item.notes,
        itemNotes: item.notes,
      })),
    })),
  });
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ownerUserId = process.env.MENU_OWNER_USER_ID ?? process.env.NEXT_PUBLIC_MENU_OWNER_USER_ID;

  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Ambiente incompleto: configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  let body: CreateOrderBody;
  try {
    body = (await request.json()) as CreateOrderBody;
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) {
    return NextResponse.json({ error: "Pedido vazio." }, { status: 400 });
  }
  if (rawItems.length > 50) {
    return NextResponse.json({ error: "Quantidade de itens excede o limite permitido." }, { status: 400 });
  }

  const parsedItems = rawItems
    .map((item) => {
      const drinkId = typeof item.drinkId === "string" ? item.drinkId.trim() : "";
      const qty = Number(item.qty);
      return {
        drinkId,
        qty: Number.isInteger(qty) ? qty : NaN,
        notes: sanitizeText(item.notes, 50),
      };
    })
    .filter((item) => item.drinkId && Number.isFinite(item.qty));

  if (!parsedItems.length || parsedItems.some((item) => item.qty <= 0 || item.qty > 30)) {
    return NextResponse.json({ error: "Itens do pedido inválidos." }, { status: 400 });
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let statePayload: AppStatePayload | null = null;

  if (ownerUserId) {
    const { data, error } = await supabase.from("app_state").select("state").eq("user_id", ownerUserId).maybeSingle();

    if (error) {
      return NextResponse.json({ error: "Falha ao carregar cardápio para cálculo do pedido." }, { status: 500 });
    }
    statePayload = (data?.state as AppStatePayload | null | undefined) ?? null;
  } else {
    const { data, error } = await supabase
      .from("app_state")
      .select("state")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "Falha ao carregar cardápio para cálculo do pedido." }, { status: 500 });
    }
    statePayload = (data?.state as AppStatePayload | null | undefined) ?? null;
  }

  if (!statePayload) {
    return NextResponse.json({ error: "Cardápio indisponível para registrar pedido." }, { status: 500 });
  }

  const ingredients = Array.isArray(statePayload.ingredients) ? statePayload.ingredients : [];
  const drinks = (Array.isArray(statePayload.drinks) ? statePayload.drinks : []).filter((drink) => drink.showOnPublicMenu);
  const settings = { ...DEFAULT_SETTINGS, ...(statePayload.settings ?? {}) };

  const drinksById = new Map(drinks.map((drink) => [drink.id, drink]));
  const normalizedCart = new Map<string, { drinkId: string; qty: number; notes: string | null }>();
  for (const item of parsedItems) {
    const key = `${item.drinkId}::${item.notes ?? ""}`;
    const previous = normalizedCart.get(key);
    normalizedCart.set(key, {
      drinkId: item.drinkId,
      notes: item.notes,
      qty: (previous?.qty ?? 0) + item.qty,
    });
  }

  const orderItems: Array<{ drink_id: string; drink_name: string; unit_price: number; qty: number; line_total: number; notes: string | null }> = [];

  for (const item of normalizedCart.values()) {
    const drink = drinksById.get(item.drinkId);
    if (!drink) {
      return NextResponse.json({ error: "Um ou mais drinks não estão disponíveis no cardápio público." }, { status: 400 });
    }

    const unitPrice = roundMoney(getFinalDrinkPrice(drink, ingredients, settings));
    const lineTotal = roundMoney(unitPrice * item.qty);

    orderItems.push({
      drink_id: drink.id,
      drink_name: drink.name,
      unit_price: unitPrice,
      qty: item.qty,
      line_total: lineTotal,
      notes: item.notes,
    });
  }

  const subtotal = roundMoney(orderItems.reduce((acc, item) => acc + item.line_total, 0));
  if (subtotal <= 0) {
    return NextResponse.json({ error: "Não foi possível calcular o total do pedido." }, { status: 400 });
  }

  const customerName = sanitizeText(body.customerName, 80);
  const customerPhone = sanitizeText(body.customerPhone, 30);
  const notes = sanitizeText(body.notes, 400);
  const origin = resolveOrderSource(body);

  let createdOrder:
    | {
        id: string;
        code: string;
        status: string;
        subtotal: number;
        created_at: string;
      }
    | null = null;

  let lastError: string | null = null;
  for (let i = 0; i < 3; i += 1) {
    const code = makeOrderCode();
    const { data, error } = await supabase
      .from("orders")
      .insert({
        code,
        customer_name: customerName,
        customer_phone: customerPhone,
        notes,
        status: "pendente",
        source: origin.source,
        table_code: origin.tableCode,
        subtotal,
      })
      .select("id, code, status, subtotal, created_at")
      .single();

    if (!error && data) {
      createdOrder = data;
      break;
    }

    const message = error?.message ?? "Falha ao criar pedido.";
    lastError = message;
    if (!message.toLowerCase().includes("duplicate") && !message.toLowerCase().includes("unique")) {
      break;
    }
  }

  if (!createdOrder) {
    return NextResponse.json({ error: lastError ?? "Falha ao criar pedido." }, { status: 500 });
  }

  const itemsInsertPayload = orderItems.map((item) => ({
    order_id: createdOrder.id,
    ...item,
  }));
  let { error: itemsError } = await supabase.from("order_items").insert(itemsInsertPayload);

  if (itemsError && itemsError.message.toLowerCase().includes("notes")) {
    const fallbackPayload = itemsInsertPayload.map((itemWithNotes) => {
      const { notes, ...item } = itemWithNotes;
      void notes;
      return item;
    });
    const fallback = await supabase.from("order_items").insert(fallbackPayload);
    itemsError = fallback.error;
  }

  if (itemsError) {
    await supabase.from("orders").delete().eq("id", createdOrder.id);
    return NextResponse.json({ error: "Falha ao salvar itens do pedido." }, { status: 500 });
  }

  return NextResponse.json({
    order: {
      id: createdOrder.id,
      code: createdOrder.code,
      status: createdOrder.status,
      source: origin.source,
      tableCode: origin.tableCode,
      subtotal: createdOrder.subtotal,
      createdAt: createdOrder.created_at,
    },
  });
}
