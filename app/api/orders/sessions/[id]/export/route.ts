import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

type OrderStatus = "pendente" | "em_progresso" | "concluido";
type OrderSource = "mesa_qr" | "balcao";

type SessionRow = {
  id: string;
  code: string;
  opened_at: string;
  closed_at: string | null;
};

type OrderRow = {
  id: string;
  code: string;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  status: OrderStatus;
  source: OrderSource | null;
  table_code: string | null;
  subtotal: number;
  created_at: string;
};

type OrderItemRow = {
  order_id: string;
  drink_name: string;
  qty: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
};

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
        // sem mutação de cookie nesse fluxo
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

function csvEscape(value: unknown) {
  const raw = String(value ?? "");
  const escaped = raw.replace(/"/g, '""');
  return `"${escaped}"`;
}

function formatNumber(value: number) {
  return Number(value ?? 0).toFixed(2).replace(".", ",");
}

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
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

  const { id } = await context.params;
  const sessionId = typeof id === "string" ? id.trim() : "";
  if (!sessionId) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 400 });
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: sessionData, error: sessionError } = await supabase
    .from("order_sessions")
    .select("id, code, opened_at, closed_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: "Falha ao carregar sessão para exportação." }, { status: 500 });
  }
  const session = (sessionData as SessionRow | null | undefined) ?? null;
  if (!session) {
    return NextResponse.json({ error: "Sessão não encontrada." }, { status: 404 });
  }

  const { data: ordersData, error: ordersError } = await supabase
    .from("orders")
    .select("id, code, customer_name, customer_phone, notes, status, source, table_code, subtotal, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });

  if (ordersError) {
    return NextResponse.json({ error: "Falha ao carregar pedidos da sessão para exportação." }, { status: 500 });
  }

  const orders = (ordersData ?? []) as OrderRow[];
  const orderIds = orders.map((order) => order.id);

  let itemsData: Array<OrderItemRow | Omit<OrderItemRow, "notes">> = [];
  if (orderIds.length) {
    const withNotes = await supabase
      .from("order_items")
      .select("order_id, drink_name, qty, unit_price, line_total, notes")
      .in("order_id", orderIds)
      .order("created_at", { ascending: true });

    if (withNotes.error) {
      const fallback = await supabase
        .from("order_items")
        .select("order_id, drink_name, qty, unit_price, line_total")
        .in("order_id", orderIds)
        .order("created_at", { ascending: true });
      if (fallback.error) {
        return NextResponse.json({ error: "Falha ao carregar itens para exportação." }, { status: 500 });
      }
      itemsData = (fallback.data ?? []).map((item) => ({ ...item, notes: null }));
    } else {
      itemsData = withNotes.data ?? [];
    }
  }

  const itemsByOrderId = new Map<string, OrderItemRow[]>();
  for (const item of itemsData as OrderItemRow[]) {
    const list = itemsByOrderId.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrderId.set(item.order_id, list);
  }

  const header = [
    "sessao_codigo",
    "sessao_aberta_em",
    "sessao_fechada_em",
    "pedido_codigo",
    "pedido_criado_em",
    "pedido_status",
    "origem",
    "mesa",
    "cliente",
    "telefone",
    "obs_pedido",
    "drink",
    "qtd",
    "preco_unitario",
    "subtotal_item",
    "obs_item",
    "subtotal_pedido",
  ];

  const rows: string[] = [];
  rows.push(header.map(csvEscape).join(";"));

  for (const order of orders) {
    const base = [
      session.code,
      session.opened_at,
      session.closed_at ?? "",
      order.code,
      order.created_at,
      order.status,
      order.source === "mesa_qr" ? "mesa_qr" : "balcao",
      order.source === "mesa_qr" ? order.table_code ?? "" : "",
      order.customer_name ?? "",
      order.customer_phone ?? "",
      order.notes ?? "",
    ];

    const items = itemsByOrderId.get(order.id) ?? [];
    if (!items.length) {
      const line = [...base, "", "", "", "", "", formatNumber(order.subtotal)];
      rows.push(line.map(csvEscape).join(";"));
      continue;
    }

    for (const item of items) {
      const line = [
        ...base,
        item.drink_name,
        String(item.qty),
        formatNumber(item.unit_price),
        formatNumber(item.line_total),
        item.notes ?? "",
        formatNumber(order.subtotal),
      ];
      rows.push(line.map(csvEscape).join(";"));
    }
  }

  const csv = `\uFEFF${rows.join("\n")}`;
  const filename = `${session.code.replace(/[^a-zA-Z0-9-_]/g, "_")}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
