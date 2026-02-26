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
    source?: "mesa_qr" | "balcao";
    tableCode?: string | null;
    subtotal: number;
    createdAt: string;
  };
  error?: string;
};

type OrderConfirmation = {
  code: string;
  items: Array<{ drinkName: string; qty: number }>;
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

function normalizeTableCode(value: string | null) {
  if (!value) return null;
  const cleaned = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!cleaned) return null;
  if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(cleaned)) return null;
  return cleaned;
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
  const [qrTableCode, setQrTableCode] = useState<string | null>(null);
  const [qrTableToken, setQrTableToken] = useState("");
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
  const [orderConfirmation, setOrderConfirmation] = useState<OrderConfirmation | null>(null);
  const [confirmationCountdown, setConfirmationCountdown] = useState<number | null>(null);
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
    const params = new URLSearchParams(window.location.search);
    const tableCode = normalizeTableCode(params.get("mesa") ?? params.get("table") ?? params.get("m"));
    const tableToken = (params.get("token") ?? params.get("t") ?? "").trim().toLowerCase().slice(0, 128);
    setQrTableCode(tableCode);
    setQrTableToken(tableToken);

    // Captura o contexto da mesa e limpa a URL para não expor query no navegador.
    if (window.location.search) {
      const cleanPath = window.location.pathname === "/cardapio" ? "/" : window.location.pathname;
      window.history.replaceState({}, "", cleanPath);
    }
  }, []);

  useEffect(() => {
    writeCart(cartItems);
  }, [cartItems]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsCartOpen(false);
      setSelectedDrinkId(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  useEffect(() => {
    if (!isCartOpen || !checkoutSuccess || !orderConfirmation) {
      setConfirmationCountdown(null);
      return;
    }

    setConfirmationCountdown(5);
    let remaining = 5;
    const timer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(timer);
        setConfirmationCountdown(0);
        setIsCartOpen(false);
        return;
      }
      setConfirmationCountdown(remaining);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isCartOpen, checkoutSuccess, orderConfirmation]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const ingredientMap = new Map(ingredients.map((i) => [i.id, i]));

    return drinks
      .filter((d) => d.showOnPublicMenu)
      .map((drink) => {
        const ingredientNames = Array.from(
          new Set(
            drink.items
              .map((item) => ingredientMap.get(item.ingredientId)?.name?.trim())
              .filter((name): name is string => Boolean(name))
          )
        );
        const cost = computeDrinkCost(drink, ingredients, settings);
        const markup = applyPsychRounding(cost * settings.markup, settings.roundingMode);
        const cmv = settings.targetCmv > 0 ? applyPsychRounding(cost / settings.targetCmv, settings.roundingMode) : 0;

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
      })
      .filter(({ drink, ingredientNames }) =>
        q
          ? drink.name.toLowerCase().includes(q) || ingredientNames.some((name) => name.toLowerCase().includes(q))
          : true
      )
      .sort((a, b) => a.drink.name.localeCompare(b.drink.name));
  }, [drinks, ingredients, search, settings]);

  const rowByDrinkId = useMemo(() => new Map(rows.map((row) => [row.drink.id, row])), [rows]);
  const selectedRow = selectedDrinkId ? rowByDrinkId.get(selectedDrinkId) ?? null : null;

  const cartCount = useMemo(() => cartItems.reduce((acc, item) => acc + item.qty, 0), [cartItems]);
  const cartSubtotal = useMemo(() => roundMoney(cartItems.reduce((acc, item) => acc + item.unitPrice * item.qty, 0)), [cartItems]);

  const addToCart = (drinkId: string, qty: number, drinkNotesRaw: string) => {
    const row = rowByDrinkId.get(drinkId);
    if (!row) return;
    const safeQty = Math.max(1, Math.min(30, Math.floor(qty)));
    const drinkNotes = drinkNotesRaw.trim().slice(0, 50);

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
    const normalizedNotes = editingDrinkNotes.trim().slice(0, 50);

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
    setOrderConfirmation(null);
  };

  const submitOrder = async () => {
    if (!cartItems.length || isSubmittingOrder) return;

    setIsSubmittingOrder(true);
    setCheckoutError("");
    setCheckoutSuccess("");
    setOrderConfirmation(null);

    try {
      const summaryByDrink = new Map<string, number>();
      for (const item of cartItems) {
        summaryByDrink.set(item.drinkName, (summaryByDrink.get(item.drinkName) ?? 0) + item.qty);
      }

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cartItems.map((item) => ({ drinkId: item.drinkId, qty: item.qty, notes: item.drinkNotes })),
          customerName,
          customerPhone,
          notes: orderNotes,
          tableCode: qrTableCode,
          tableToken: qrTableToken || undefined,
        }),
      });

      const payload = (await res.json()) as CreateOrderResponse;

      if (!res.ok || !payload.order) {
        setCheckoutError(payload.error ?? "Não foi possível concluir o pedido.");
        return;
      }

      setCheckoutSuccess(`Pedido ${payload.order.code} criado com sucesso.`);
      setOrderConfirmation({
        code: payload.order.code,
        items: Array.from(summaryByDrink.entries()).map(([drinkName, qty]) => ({ drinkName, qty })),
      });
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
    ["--brand-terracotta" as never]: "#A4362C",
    ["--brand-teal" as never]: "#006479",
    ["--brand-cream" as never]: "#F7F4E3",
    ["--bg" as never]: "#8E3E36",
    ["--panel" as never]: "#FFFCEF",
    ["--panel2" as never]: "#F5E2DE",
    ["--panel-elevated" as never]: "#FFFEF7",
    ["--ink" as never]: "#3E2A27",
    ["--muted" as never]: "#7A605C",
    ["--border" as never]: "#DDC5BF",
    ["--shadow" as never]: "0 12px 28px rgba(72, 22, 16, 0.2)",
    ["--accent" as never]: "#A4362C",
    ["--accent-strong" as never]: "#8A2D24",
    ["--neutral-soft" as never]: "#F0E1DD",
    ["--danger-bg" as never]: "#FBE8E5",
    ["--danger-border" as never]: "#E5B8B0",
    ["--danger-ink" as never]: "#7D2E25",
    ["--success-bg" as never]: "#EAF8EE",
    ["--success-border" as never]: "#B9E1C3",
    ["--success-ink" as never]: "#1E5A2C",
    ["--overlay" as never]: "rgba(103, 32, 25, 0.3)",
    ["--modal-shadow" as never]: "0 24px 56px rgba(72, 22, 16, 0.28)",
  };

  const page: React.CSSProperties = {
    ...themeVars,
    background: "var(--bg)",
    minHeight: "100vh",
    color: "var(--ink)",
    padding: 24,
    paddingBottom: 104,
    fontFamily: 'var(--font-app-sans), "Trebuchet MS", "Segoe UI", sans-serif',
  };

  const container: React.CSSProperties = { maxWidth: 1160, margin: "0 auto" };

  const input: React.CSSProperties = {
    width: "100%",
    padding: 12,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--panel-elevated)",
    outline: "none",
  };

  const fontScale = {
    sm: 12,
    md: 14,
    lg: 20,
  } as const;

  const menuSectionWidth = "min(100%, 916px)";
  const searchWidth = "min(100%, 452px)";
  const small: React.CSSProperties = { fontSize: fontScale.sm, color: "var(--muted)" };

  return (
    <div style={page}>
      <style>{`.public-search::placeholder { color: rgba(247, 244, 227, 0.78); }`}</style>
      <div style={container}>
        <div style={{ display: "grid", justifyItems: "center", marginBottom: 14 }}>
          <img
            src="/manteca-logo.svg"
            alt="Manteca"
            title={
              hydrating
                ? "Carregando cardápio..."
                : dataSource === "supabase"
                ? "Dados do Supabase"
                : dataSource === "local"
                ? "Dados locais (cache)"
                : "Erro ao carregar"
            }
            style={{ width: "min(360px, 92vw)", height: "auto", display: "block" }}
          />
        </div>

        <div style={{ display: "grid", justifyItems: "center" }}>
          <div style={{ width: menuSectionWidth, marginBottom: 10, textAlign: "center", color: "var(--brand-cream)", fontSize: fontScale.sm, opacity: 0.95 }}>
            Origem do pedido: {qrTableCode ? `Mesa ${qrTableCode}` : "Balcão"}
          </div>

          {loadError ? (
            <div style={{ width: menuSectionWidth, marginBottom: 12, padding: 10, borderRadius: 12, border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-ink)", fontSize: fontScale.sm }}>
              {loadError}
            </div>
          ) : null}

          <input
            className="public-search"
            style={{
              ...input,
              width: searchWidth,
              fontSize: fontScale.sm,
              padding: "8px 2px",
              border: 0,
              borderBottom: "1px solid rgba(247, 244, 227, 0.95)",
              borderRadius: 0,
              background: "transparent",
              color: "var(--brand-cream)",
              boxShadow: "none",
              caretColor: "var(--brand-cream)",
            }}
            placeholder="Buscar drink ou ingrediente"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div
            style={{
              marginTop: 12,
              width: menuSectionWidth,
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
                  background: "var(--panel-elevated)",
                  overflow: "hidden",
                  aspectRatio: "4 / 5",
                  display: "grid",
                  gridTemplateRows: "7fr 3fr",
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
                    fontSize: fontScale.sm,
                  }}
                >
                  {drink.photoDataUrl ? (
                    <img src={drink.photoDataUrl} alt={drink.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    "Sem foto"
                  )}
                </div>

                <div style={{ padding: 10, display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center", minHeight: 0 }}>
                  <div style={{ fontSize: fontScale.md, fontWeight: 700, lineHeight: 1.1 }}>{drink.name}</div>
                  <div
                    style={{
                      ...small,
                      marginTop: 4,
                      fontSize: fontScale.sm,
                      lineHeight: 1.25,
                      color: "var(--muted)",
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
                      <div style={{ fontSize: fontScale.md, fontWeight: 650 }}>{formatBRL(displayPrice)}</div>
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

        <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
          <Link
            href="/admin"
            style={{
              textDecoration: "none",
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid var(--border)",
              background: "var(--panel)",
              color: "var(--muted)",
              fontWeight: 500,
              fontSize: fontScale.sm,
            }}
          >
            Área interna
          </Link>
        </div>
      </div>

      {selectedRow && (
        <div
          onClick={() => setSelectedDrinkId(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--overlay)",
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
              background: "var(--panel-elevated)",
              borderRadius: 18,
              border: "1px solid var(--border)",
              overflow: "hidden",
              boxShadow: "var(--modal-shadow)",
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
                      background: "var(--panel-elevated)",
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
                  <div style={{ marginTop: 10, fontSize: fontScale.md, color: "var(--muted)" }}>{selectedRow.drink.notes}</div>
                ) : null}

                {selectedRow.displayPrice !== null ? (
                  <div style={{ marginTop: 12, fontWeight: 800, fontSize: fontScale.lg }}>{formatBRL(selectedRow.displayPrice)}</div>
                ) : (
                  <div style={{ marginTop: 12, fontWeight: 700, fontSize: fontScale.md, color: "var(--muted)" }}>
                    Preço exibido no checkout
                  </div>
                )}

                <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <label style={{ ...small, fontWeight: 700 }}>Quantidade</label>
                  <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--panel-elevated)" }}>
                    <button
                      onClick={() => setModalQty((prev) => Math.max(1, prev - 1))}
                      disabled={modalQty <= 1}
                      style={{
                        border: 0,
                        borderRight: "1px solid var(--border)",
                        background: modalQty <= 1 ? "var(--neutral-soft)" : "var(--panel-elevated)",
                        color: "var(--ink)",
                        width: 34,
                        height: 34,
                        fontWeight: 800,
                        fontSize: fontScale.lg,
                        cursor: modalQty <= 1 ? "not-allowed" : "pointer",
                      }}
                      aria-label="Diminuir quantidade"
                    >
                      -
                    </button>
                    <div style={{ minWidth: 34, textAlign: "center", fontWeight: 700, fontSize: fontScale.md }}>{modalQty}</div>
                    <button
                      onClick={() => setModalQty((prev) => Math.min(30, prev + 1))}
                      disabled={modalQty >= 30}
                      style={{
                        border: 0,
                        borderLeft: "1px solid var(--border)",
                        background: modalQty >= 30 ? "var(--neutral-soft)" : "var(--panel-elevated)",
                        color: "var(--ink)",
                        width: 34,
                        height: 34,
                        fontWeight: 800,
                        fontSize: fontScale.lg,
                        cursor: modalQty >= 30 ? "not-allowed" : "pointer",
                      }}
                      aria-label="Aumentar quantidade"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                  <label style={{ ...small, fontWeight: 700 }}>Observações (opcional)</label>
                  <textarea
                    style={{ ...input, resize: "vertical", minHeight: 78 }}
                    placeholder="Ex.: pouco gelo, sem canudo..."
                    value={modalDrinkNotes}
                    onChange={(e) => setModalDrinkNotes(e.target.value)}
                    maxLength={50}
                  />
                </div>
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => {
                      addToCart(selectedRow.drink.id, modalQty, modalDrinkNotes);
                      setSelectedDrinkId(null);
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

      {cartCount > 0 && (
        <button
          onClick={() => setIsCartOpen(true)}
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 40,
            border: "1px solid var(--accent-strong)",
            borderRadius: 999,
            background: "var(--accent)",
            color: "white",
            padding: "12px 20px",
            fontWeight: 800,
            fontSize: fontScale.md,
            boxShadow: "0 14px 28px rgba(103, 32, 25, 0.3)",
            cursor: "pointer",
          }}
        >
          Ver resumo do pedido ({cartCount})
        </button>
      )}

      {isCartOpen && (
        <div
          onClick={() => setIsCartOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--overlay)",
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
              background: "var(--panel-elevated)",
              borderRadius: 18,
              border: "1px solid var(--border)",
              boxShadow: "var(--modal-shadow)",
              padding: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Seu pedido ({cartCount})</h2>
              {checkoutSuccess && orderConfirmation ? (
                <div style={{ ...small, fontWeight: 700 }}>
                  Fechando em {confirmationCountdown ?? 5}s
                </div>
              ) : (
                <button
                  onClick={() => setIsCartOpen(false)}
                  style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--panel-elevated)", padding: "6px 10px", cursor: "pointer" }}
                >
                  Fechar
                </button>
              )}
            </div>

            {checkoutError ? (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "var(--danger-bg)", border: "1px solid var(--danger-border)", color: "var(--danger-ink)", fontSize: fontScale.md }}>
                {checkoutError}
              </div>
            ) : null}

            {checkoutSuccess && orderConfirmation ? (
              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                <div style={{ padding: 12, borderRadius: 12, background: "var(--success-bg)", border: "1px solid var(--success-border)", color: "var(--success-ink)", fontSize: fontScale.md, fontWeight: 700 }}>
                  Pedido {orderConfirmation.code} criado com sucesso.
                </div>
                <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--panel2)" }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Resumo do pedido</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {orderConfirmation.items.map((item) => (
                      <div key={`${orderConfirmation.code}_${item.drinkName}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: fontScale.md }}>
                        <span>{item.drinkName}</span>
                        <strong>{item.qty}x</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
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
                                  placeholder="Observações (opcional)"
                                  value={editingDrinkNotes}
                                  onChange={(e) => setEditingDrinkNotes(e.target.value)}
                                  maxLength={50}
                                />
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  <button
                                    onClick={() => saveCartItemNotes(item.id)}
                                    style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--accent)", color: "white", padding: "5px 8px", cursor: "pointer", fontSize: fontScale.sm, fontWeight: 700 }}
                                  >
                                    Salvar
                                  </button>
                                  <button
                                    onClick={cancelEditCartItemNotes}
                                    style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel-elevated)", color: "var(--ink)", padding: "5px 8px", cursor: "pointer", fontSize: fontScale.sm, fontWeight: 700 }}
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <div style={small}>Observações: {item.drinkNotes ? item.drinkNotes : "sem observações"}</div>
                                <button
                                  onClick={() => startEditCartItemNotes(item)}
                                  style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel-elevated)", color: "var(--muted)", padding: "2px 7px", cursor: "pointer", fontSize: fontScale.sm, fontWeight: 700 }}
                                >
                                  Editar
                                </button>
                              </div>
                            )}
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--panel-elevated)" }}>
                              <button
                                onClick={() => updateCartQty(item.id, item.qty - 1)}
                                disabled={item.qty <= 1}
                                style={{
                                  border: 0,
                                  borderRight: "1px solid var(--border)",
                                  background: item.qty <= 1 ? "var(--neutral-soft)" : "var(--panel-elevated)",
                                  color: "var(--ink)",
                                  width: 34,
                                  height: 34,
                                  fontWeight: 800,
                                  fontSize: fontScale.lg,
                                  cursor: item.qty <= 1 ? "not-allowed" : "pointer",
                                }}
                                aria-label={`Diminuir quantidade de ${item.drinkName}`}
                              >
                                -
                              </button>
                              <div style={{ minWidth: 34, textAlign: "center", fontWeight: 700, fontSize: fontScale.md }}>{item.qty}</div>
                              <button
                                onClick={() => updateCartQty(item.id, item.qty + 1)}
                                disabled={item.qty >= 30}
                                style={{
                                  border: 0,
                                  borderLeft: "1px solid var(--border)",
                                  background: item.qty >= 30 ? "var(--neutral-soft)" : "var(--panel-elevated)",
                                  color: "var(--ink)",
                                  width: 34,
                                  height: 34,
                                  fontWeight: 800,
                                  fontSize: fontScale.lg,
                                  cursor: item.qty >= 30 ? "not-allowed" : "pointer",
                                }}
                                aria-label={`Aumentar quantidade de ${item.drinkName}`}
                              >
                                +
                              </button>
                            </div>
                            <button
                              onClick={() => removeCartItem(item.id)}
                              style={{ border: "1px solid var(--danger-border)", borderRadius: 10, background: "var(--danger-bg)", color: "var(--danger-ink)", padding: "8px 10px", cursor: "pointer" }}
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
                  <div style={{ fontWeight: 800, fontSize: fontScale.lg }}>Subtotal: {formatBRL(cartSubtotal)}</div>

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
                      background: !cartItems.length || isSubmittingOrder ? "var(--neutral-soft)" : "var(--accent)",
                      color: "white",
                      padding: "12px 14px",
                      fontWeight: 800,
                      cursor: !cartItems.length || isSubmittingOrder ? "not-allowed" : "pointer",
                    }}
                  >
                    {isSubmittingOrder ? "Enviando pedido..." : "Concluir pedido"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
