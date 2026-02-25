"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

type RecipeUnit = "ml" | "un" | "dash" | "drop";
type PricingModel = "by_ml" | "by_bottle" | "by_unit";
type PublicMenuDrinkPriceMode = "markup" | "cmv" | "manual";
type PublicMenuPriceVisibility = "show" | "none";
type RoundingMode = "none" | "end_90" | "end_00" | "end_50";

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
  notes?: string;
  photoDataUrl?: string;
  showOnPublicMenu?: boolean;
  publicMenuPriceMode?: PublicMenuDrinkPriceMode;
  manualPublicPrice?: number;
};

type Settings = {
  markup: number;
  targetCmv: number;
  dashMl: number;
  dropMl: number;
  publicMenuPriceVisibility: PublicMenuPriceVisibility;
  roundingMode: RoundingMode;
};

const DEFAULT_SETTINGS: Settings = {
  markup: 4,
  targetCmv: 0.2,
  dashMl: 0.9,
  dropMl: 0.05,
  publicMenuPriceVisibility: "show",
  roundingMode: "end_90",
};

type AppStatePayload = {
  ingredients?: Ingredient[];
  drinks?: Drink[];
  settings?: Settings;
};
type PublicMenuResponse = {
  state?: AppStatePayload | null;
  updatedAt?: string | null;
  error?: string;
};
type CachedPublicMenu = {
  state: AppStatePayload;
  updatedAt: string | null;
};
type CartItem = {
  id: string;
  drinkId: string;
  drinkName: string;
  unitPrice: number;
  qty: number;
  drinkNotes?: string;
  photoDataUrl?: string;
};

type CreateOrderResponse = {
  order?: {
    id: string;
    code: string;
    status: string;
    subtotal: number;
    createdAt: string;
  };
  error?: string;
};

const PUBLIC_MENU_CACHE_KEY = "public_menu_cache_v1";
const PUBLIC_MENU_CART_KEY = "public_menu_cart_v1";

function makeCartItemId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cart_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

type DrinkLike = Partial<Drink> & {
  publicMenuPriceMode?: string;
};

type SettingsLike = Partial<Settings> & {
  publicMenuPriceMode?: string;
};

function normalizeDrink(raw?: DrinkLike | null): Drink {
  const priceMode: PublicMenuDrinkPriceMode =
    raw?.publicMenuPriceMode === "cmv" || raw?.publicMenuPriceMode === "manual" ? raw.publicMenuPriceMode : "markup";
  const manualPublicPrice = Number(raw?.manualPublicPrice);
  const id = typeof raw?.id === "string" && raw.id.trim() ? raw.id : `drink_${Date.now().toString(16)}`;
  const name = typeof raw?.name === "string" ? raw.name : "Drink";
  const items = Array.isArray(raw?.items) ? raw.items : [];

  return {
    ...raw,
    id,
    name,
    items,
    showOnPublicMenu: Boolean(raw?.showOnPublicMenu),
    publicMenuPriceMode: priceMode,
    manualPublicPrice: Number.isFinite(manualPublicPrice) ? manualPublicPrice : 0,
  };
}

function normalizeSettings(raw?: SettingsLike | null): Settings {
  const visibility: PublicMenuPriceVisibility =
    raw?.publicMenuPriceVisibility === "none" || raw?.publicMenuPriceMode === "none" ? "none" : "show";

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    publicMenuPriceVisibility: visibility,
  };
}

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
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

function readPublicMenuCache(): CachedPublicMenu | null {
  try {
    const raw = localStorage.getItem(PUBLIC_MENU_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPublicMenu;
    if (!parsed || typeof parsed !== "object" || !parsed.state) return null;
    return {
      state: parsed.state,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return null;
  }
}

function writePublicMenuCache(state: AppStatePayload, updatedAt: string | null) {
  try {
    const payload: CachedPublicMenu = { state, updatedAt };
    localStorage.setItem(PUBLIC_MENU_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // noop
  }
}

function readCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(PUBLIC_MENU_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CartItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        id: typeof item.id === "string" && item.id.trim() ? item.id : makeCartItemId(),
        drinkId: typeof item.drinkId === "string" ? item.drinkId : "",
        drinkName: typeof item.drinkName === "string" ? item.drinkName : "",
        unitPrice: Number(item.unitPrice),
        qty: Number(item.qty),
        drinkNotes: typeof item.drinkNotes === "string" ? item.drinkNotes : undefined,
        photoDataUrl: typeof item.photoDataUrl === "string" ? item.photoDataUrl : undefined,
      }))
      .filter((item) => item.drinkId && item.drinkName && Number.isFinite(item.unitPrice) && item.qty > 0);
  } catch {
    return [];
  }
}

function writeCart(items: CartItem[]) {
  try {
    localStorage.setItem(PUBLIC_MENU_CART_KEY, JSON.stringify(items));
  } catch {
    // noop
  }
}

export default function PublicMenuPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [search, setSearch] = useState("");
  const [hydrating, setHydrating] = useState(true);
  const [dataSource, setDataSource] = useState<"supabase" | "local" | "error">("supabase");
  const [loadError, setLoadError] = useState("");

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [selectedDrinkId, setSelectedDrinkId] = useState<string | null>(null);
  const [modalQty, setModalQty] = useState(1);
  const [modalDrinkNotes, setModalDrinkNotes] = useState("");
  const [isCartOpen, setIsCartOpen] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [checkoutSuccess, setCheckoutSuccess] = useState("");
  const [editingCartItemId, setEditingCartItemId] = useState<string | null>(null);
  const [editingDrinkNotes, setEditingDrinkNotes] = useState("");

  const applyState = (state: AppStatePayload | null | undefined) => {
    if (!state) return false;
    if (state.ingredients) setIngredients(state.ingredients);
    if (state.drinks) setDrinks(state.drinks.map((d) => normalizeDrink(d)));
    if (state.settings) setSettings(normalizeSettings(state.settings));
    return Boolean(state.ingredients || state.drinks || state.settings);
  };

  useEffect(() => {
    setCartItems(readCart());
  }, []);

  useEffect(() => {
    writeCart(cartItems);
  }, [cartItems]);

  useEffect(() => {
    let active = true;

    (async () => {
      const localCache = readPublicMenuCache();
      const hasLocalCache = Boolean(localCache?.state && applyState(localCache.state));
      if (active && hasLocalCache) {
        setDataSource("local");
        setLoadError("");
      }

      try {
        const params = new URLSearchParams();
        if (localCache?.updatedAt) params.set("since", localCache.updatedAt);
        const endpoint = params.size ? `/api/public-menu?${params.toString()}` : "/api/public-menu";
        const res = await fetch(endpoint, { cache: "no-store" });

        if (res.status === 304) {
          if (active) {
            setLoadError("");
            setDataSource(hasLocalCache ? "local" : "supabase");
          }
          return;
        }

        const payload = (await res.json()) as PublicMenuResponse;

        if (!res.ok) {
          if (active) {
            if (hasLocalCache) {
              setDataSource("local");
              setLoadError("Não foi possível atualizar agora. Exibindo dados locais salvos.");
            } else {
              setDataSource("error");
              setLoadError(payload.error ?? "Não foi possível carregar os dados públicos no Supabase.");
            }
          }
          return;
        }

        if (active && applyState(payload.state)) {
          writePublicMenuCache(payload.state ?? {}, payload.updatedAt ?? null);
          setDataSource("supabase");
          setLoadError("");
        } else if (active) {
          if (hasLocalCache) {
            setDataSource("local");
            setLoadError("Não foi possível atualizar agora. Exibindo dados locais salvos.");
          } else {
            setDataSource("error");
            setLoadError("Não foi possível carregar os dados públicos no Supabase.");
          }
        }
      } catch {
        if (active) {
          if (hasLocalCache) {
            setDataSource("local");
            setLoadError("Erro ao atualizar do Supabase. Exibindo dados locais salvos.");
          } else {
            setDataSource("error");
            setLoadError("Erro ao consultar o Supabase para o cardápio público.");
          }
        }
      } finally {
        if (active) setHydrating(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const ingredientMap = new Map(ingredients.map((i) => [i.id, i]));

    return drinks
      .filter((d) => d.showOnPublicMenu)
      .filter((d) => (q ? d.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((drink) => {
        const cost = computeDrinkCost(drink, ingredients, settings);
        const markup = applyPsychRounding(cost * settings.markup, settings.roundingMode);
        const cmv = settings.targetCmv > 0 ? applyPsychRounding(cost / settings.targetCmv, settings.roundingMode) : 0;
        const ingredientNames = Array.from(
          new Set(
            drink.items
              .map((item) => ingredientMap.get(item.ingredientId)?.name?.trim())
              .filter((name): name is string => Boolean(name))
          )
        );

        const orderPrice =
          drink.publicMenuPriceMode === "manual"
            ? roundMoney(drink.manualPublicPrice ?? 0)
            : drink.publicMenuPriceMode === "cmv"
            ? roundMoney(cmv)
            : roundMoney(markup);

        const displayPrice = settings.publicMenuPriceVisibility === "none" ? null : orderPrice;

        return {
          drink,
          displayPrice,
          orderPrice,
          ingredientNames,
        };
      });
  }, [drinks, ingredients, search, settings]);

  const rowByDrinkId = useMemo(() => new Map(rows.map((row) => [row.drink.id, row])), [rows]);
  const selectedRow = selectedDrinkId ? rowByDrinkId.get(selectedDrinkId) ?? null : null;

  const cartCount = useMemo(() => cartItems.reduce((acc, item) => acc + item.qty, 0), [cartItems]);
  const cartSubtotal = useMemo(() => roundMoney(cartItems.reduce((acc, item) => acc + item.unitPrice * item.qty, 0)), [cartItems]);

  const addToCart = (drinkId: string, qty: number, drinkNotesRaw: string) => {
    const row = rowByDrinkId.get(drinkId);
    if (!row) return;
    const safeQty = Math.max(1, Math.min(30, Math.floor(qty)));
    const drinkNotes = drinkNotesRaw.trim().slice(0, 240);

    setCartItems((prev) => {
      const idx = prev.findIndex((item) => item.drinkId === drinkId && (item.drinkNotes ?? "") === drinkNotes);
      if (idx < 0) {
        return [
          ...prev,
          {
            id: makeCartItemId(),
            drinkId,
            drinkName: row.drink.name,
            unitPrice: row.orderPrice,
            qty: safeQty,
            drinkNotes: drinkNotes || undefined,
            photoDataUrl: row.drink.photoDataUrl,
          },
        ];
      }

      const next = [...prev];
      next[idx] = { ...next[idx], qty: Math.min(30, next[idx].qty + safeQty) };
      return next;
    });
  };

  const updateCartQty = (itemId: string, qty: number) => {
    const safeQty = Math.max(1, Math.min(30, Math.floor(qty || 1)));
    setCartItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, qty: safeQty } : item)));
  };

  const removeCartItem = (itemId: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== itemId));
    if (editingCartItemId === itemId) {
      setEditingCartItemId(null);
      setEditingDrinkNotes("");
    }
  };

  const startEditCartItemNotes = (item: CartItem) => {
    setEditingCartItemId(item.id);
    setEditingDrinkNotes(item.drinkNotes ?? "");
  };

  const cancelEditCartItemNotes = () => {
    setEditingCartItemId(null);
    setEditingDrinkNotes("");
  };

  const saveCartItemNotes = (itemId: string) => {
    const normalizedNotes = editingDrinkNotes.trim().slice(0, 240);

    setCartItems((prev) => {
      const current = prev.find((item) => item.id === itemId);
      if (!current) return prev;

      const targetNotes = normalizedNotes || undefined;
      const mergeIdx = prev.findIndex(
        (item) => item.id !== itemId && item.drinkId === current.drinkId && (item.drinkNotes ?? "") === (targetNotes ?? "")
      );

      if (mergeIdx >= 0) {
        const next = [...prev];
        next[mergeIdx] = { ...next[mergeIdx], qty: Math.min(30, next[mergeIdx].qty + current.qty) };
        return next.filter((item) => item.id !== itemId);
      }

      return prev.map((item) => (item.id === itemId ? { ...item, drinkNotes: targetNotes } : item));
    });

    setEditingCartItemId(null);
    setEditingDrinkNotes("");
  };

  const openDrinkModal = (drinkId: string) => {
    setSelectedDrinkId(drinkId);
    setModalQty(1);
    setModalDrinkNotes("");
    setCheckoutError("");
    setCheckoutSuccess("");
  };

  const submitOrder = async () => {
    if (!cartItems.length || isSubmittingOrder) return;

    setIsSubmittingOrder(true);
    setCheckoutError("");
    setCheckoutSuccess("");

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cartItems.map((item) => ({ drinkId: item.drinkId, qty: item.qty, notes: item.drinkNotes })),
          customerName,
          customerPhone,
          notes: orderNotes,
        }),
      });

      const payload = (await res.json()) as CreateOrderResponse;

      if (!res.ok || !payload.order) {
        setCheckoutError(payload.error ?? "Não foi possível concluir o pedido.");
        return;
      }

      setCheckoutSuccess(`Pedido ${payload.order.code} criado com sucesso.`);
      setCartItems([]);
      setCustomerName("");
      setCustomerPhone("");
      setOrderNotes("");
      setEditingCartItemId(null);
      setEditingDrinkNotes("");
    } catch {
      setCheckoutError("Erro de rede ao concluir pedido.");
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const themeVars: React.CSSProperties = {
    ["--bg" as never]: "#f6f2ea",
    ["--panel" as never]: "#fffdf9",
    ["--panel2" as never]: "#fff4e7",
    ["--ink" as never]: "#1d232a",
    ["--muted" as never]: "#5a6672",
    ["--border" as never]: "#dccdb8",
    ["--shadow" as never]: "0 12px 30px rgba(32, 37, 42, 0.08)",
    ["--accent" as never]: "#0f766e",
  };

  const page: React.CSSProperties = {
    ...themeVars,
    background: "transparent",
    minHeight: "100vh",
    color: "var(--ink)",
    padding: 24,
    fontFamily: 'var(--font-app-sans), "Trebuchet MS", "Segoe UI", sans-serif',
  };

  const container: React.CSSProperties = { maxWidth: 1160, margin: "0 auto" };

  const card: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 18,
    padding: 16,
    boxShadow: "var(--shadow)",
  };

  const input: React.CSSProperties = {
    width: "100%",
    padding: 12,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "white",
    outline: "none",
  };

  const small: React.CSSProperties = { fontSize: 12, color: "var(--muted)" };

  return (
    <div style={page}>
      <div style={container}>
        <div style={{ ...card, marginBottom: 14, background: "linear-gradient(180deg, var(--panel) 0%, var(--panel2) 100%)" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div style={{ textAlign: "center" }}>
              <h1 style={{ margin: 0, fontSize: 26, letterSpacing: -0.5 }}>Cardápio de Drinks</h1>
              <div style={{ ...small, color: "#7a8793" }}>
                Seção pública com drinks selecionados
                {hydrating
                  ? " • carregando..."
                  : dataSource === "supabase"
                  ? " • dados do Supabase"
                  : dataSource === "local"
                  ? " • dados locais (cache)"
                  : " • erro ao carregar"}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
              <button
                onClick={() => setIsCartOpen(true)}
                style={{
                  textDecoration: "none",
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "white",
                  color: "#1d232a",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Pedido ({cartCount})
              </button>

              <Link href="/admin" style={{ textDecoration: "none", padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel2)", color: "#7a8793", fontWeight: 600, fontSize: 12 }}>
                Ir para área interna
              </Link>
            </div>
          </div>
        </div>

        <div style={card}>
          {loadError ? (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 12, border: "1px solid #f0c2c2", background: "#fff1f1", color: "#7b1f1f", fontSize: 12 }}>
              {loadError}
            </div>
          ) : null}

          <input style={input} placeholder="Buscar drink..." value={search} onChange={(e) => setSearch(e.target.value)} />

          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 220px))",
              justifyContent: "center",
              gap: 12,
            }}
          >
            {rows.map(({ drink, displayPrice, ingredientNames }) => (
              <button
                key={drink.id}
                onClick={() => openDrinkModal(drink.id)}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 16,
                  background: "white",
                  overflow: "hidden",
                  aspectRatio: "4 / 5",
                  display: "grid",
                  gridTemplateRows: "4fr 1fr",
                  cursor: "pointer",
                  padding: 0,
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    minHeight: 0,
                    background: "var(--panel2)",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--muted)",
                    fontSize: 12,
                  }}
                >
                  {drink.photoDataUrl ? (
                    <img src={drink.photoDataUrl} alt={drink.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    "Sem foto"
                  )}
                </div>

                <div style={{ padding: 10, display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center", minHeight: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.1 }}>{drink.name}</div>
                  <div
                    style={{
                      ...small,
                      marginTop: 4,
                      fontSize: 11,
                      lineHeight: 1.25,
                      color: "#7a8793",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {ingredientNames.length ? ingredientNames.join(" • ") : "Sem ingredientes cadastrados"}
                  </div>

                  {displayPrice !== null && (
                    <div style={{ marginTop: 5 }}>
                      <div style={{ fontSize: 13, fontWeight: 650 }}>{formatBRL(displayPrice)}</div>
                    </div>
                  )}
                </div>
              </button>
            ))}

            {rows.length === 0 && (
              <div style={{ padding: 14, border: "1px dashed var(--border)", borderRadius: 14, color: "var(--muted)", gridColumn: "1 / -1", background: "var(--panel2)" }}>
                Nenhum drink selecionado para o cardápio público.
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedRow && (
        <div
          onClick={() => setSelectedDrinkId(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(20, 24, 31, 0.5)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(860px, 100%)",
              background: "white",
              borderRadius: 18,
              border: "1px solid var(--border)",
              overflow: "hidden",
              boxShadow: "0 24px 56px rgba(16, 20, 28, 0.22)",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 0 }}>
              <div style={{ background: "var(--panel2)", minHeight: 240, maxHeight: 360 }}>
                {selectedRow.drink.photoDataUrl ? (
                  <img
                    src={selectedRow.drink.photoDataUrl}
                    alt={selectedRow.drink.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
                    Sem foto
                  </div>
                )}
              </div>

              <div style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
                  <h2 style={{ margin: 0 }}>{selectedRow.drink.name}</h2>
                  <button
                    onClick={() => setSelectedDrinkId(null)}
                    style={{
                      border: "1px solid var(--border)",
                      background: "white",
                      borderRadius: 10,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Fechar
                  </button>
                </div>

                <div style={{ ...small, marginTop: 8 }}>
                  {selectedRow.ingredientNames.length
                    ? selectedRow.ingredientNames.join(" • ")
                    : "Sem ingredientes cadastrados"}
                </div>

                {selectedRow.drink.notes ? (
                  <div style={{ marginTop: 10, fontSize: 13, color: "#475465" }}>{selectedRow.drink.notes}</div>
                ) : null}

                {selectedRow.displayPrice !== null ? (
                  <div style={{ marginTop: 12, fontWeight: 800, fontSize: 20 }}>{formatBRL(selectedRow.displayPrice)}</div>
                ) : (
                  <div style={{ marginTop: 12, fontWeight: 700, fontSize: 14, color: "#4e5a66" }}>
                    Preço exibido no checkout
                  </div>
                )}

                <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <label style={{ ...small, fontWeight: 700 }}>Quantidade</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={modalQty}
                    onChange={(e) => setModalQty(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                    style={{ width: 78, ...input }}
                  />
                </div>
                <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                  <label style={{ ...small, fontWeight: 700 }}>Notas para este drink (opcional)</label>
                  <textarea
                    style={{ ...input, resize: "vertical", minHeight: 78 }}
                    placeholder="Ex.: pouco gelo, sem canudo..."
                    value={modalDrinkNotes}
                    onChange={(e) => setModalDrinkNotes(e.target.value)}
                    maxLength={240}
                  />
                </div>
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => {
                      addToCart(selectedRow.drink.id, modalQty, modalDrinkNotes);
                      setSelectedDrinkId(null);
                      setIsCartOpen(true);
                    }}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      background: "var(--accent)",
                      color: "white",
                      padding: "10px 12px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Adicionar ao pedido
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isCartOpen && (
        <div
          onClick={() => setIsCartOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(20, 24, 31, 0.5)",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(920px, 100%)",
              maxHeight: "90vh",
              overflow: "auto",
              background: "white",
              borderRadius: 18,
              border: "1px solid var(--border)",
              boxShadow: "0 24px 56px rgba(16, 20, 28, 0.22)",
              padding: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Seu pedido ({cartCount})</h2>
              <button
                onClick={() => setIsCartOpen(false)}
                style={{ border: "1px solid var(--border)", borderRadius: 10, background: "white", padding: "6px 10px", cursor: "pointer" }}
              >
                Fechar
              </button>
            </div>

            {checkoutSuccess ? (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46", fontSize: 13 }}>
                {checkoutSuccess}
              </div>
            ) : null}

            {checkoutError ? (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#fff1f1", border: "1px solid #f0c2c2", color: "#7b1f1f", fontSize: 13 }}>
                {checkoutError}
              </div>
            ) : null}

            {!cartItems.length ? (
              <div style={{ marginTop: 14, padding: 14, border: "1px dashed var(--border)", borderRadius: 12, color: "var(--muted)", background: "var(--panel2)" }}>
                Seu pedido está vazio.
              </div>
            ) : (
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                {cartItems.map((item) => (
                  <div key={item.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 10, display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{item.drinkName}</div>
                        <div style={{ ...small }}>{formatBRL(item.unitPrice)} por unidade</div>
                        {editingCartItemId === item.id ? (
                          <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                            <textarea
                              style={{ ...input, ...small, minHeight: 68, padding: 8 }}
                              placeholder="Adicionar nota para este drink"
                              value={editingDrinkNotes}
                              onChange={(e) => setEditingDrinkNotes(e.target.value)}
                              maxLength={240}
                            />
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button
                                onClick={() => saveCartItemNotes(item.id)}
                                style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--accent)", color: "white", padding: "5px 8px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}
                              >
                                Salvar
                              </button>
                              <button
                                onClick={cancelEditCartItemNotes}
                                style={{ border: "1px solid var(--border)", borderRadius: 8, background: "white", color: "var(--ink)", padding: "5px 8px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <div style={small}>Notas: {item.drinkNotes ? item.drinkNotes : "sem notas"}</div>
                            <button
                              onClick={() => startEditCartItemNotes(item)}
                              style={{ border: "1px solid var(--border)", borderRadius: 8, background: "white", color: "var(--muted)", padding: "2px 7px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}
                            >
                              Editar
                            </button>
                          </div>
                        )}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={item.qty}
                          onChange={(e) => updateCartQty(item.id, Number(e.target.value) || 1)}
                          style={{ ...input, width: 76 }}
                        />
                        <button
                          onClick={() => removeCartItem(item.id)}
                          style={{ border: "1px solid #f0c2c2", borderRadius: 10, background: "#fff1f1", color: "#7b1f1f", padding: "8px 10px", cursor: "pointer" }}
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                    <div style={{ ...small, textAlign: "right" }}>
                      Total item: {formatBRL(roundMoney(item.unitPrice * item.qty))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Subtotal: {formatBRL(cartSubtotal)}</div>

              <input
                style={input}
                placeholder="Nome do cliente (opcional)"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                maxLength={80}
              />

              <input
                style={input}
                placeholder="Telefone (opcional)"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                maxLength={30}
              />

              <textarea
                style={{ ...input, resize: "vertical", minHeight: 84 }}
                placeholder="Observações do pedido (opcional)"
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                maxLength={400}
              />

              <button
                onClick={submitOrder}
                disabled={!cartItems.length || isSubmittingOrder}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  background: !cartItems.length || isSubmittingOrder ? "#ced8e3" : "var(--accent)",
                  color: "white",
                  padding: "12px 14px",
                  fontWeight: 800,
                  cursor: !cartItems.length || isSubmittingOrder ? "not-allowed" : "pointer",
                }}
              >
                {isSubmittingOrder ? "Enviando pedido..." : "Concluir pedido"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
