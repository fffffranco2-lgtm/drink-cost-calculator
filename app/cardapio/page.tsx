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

export default function PublicMenuPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [search, setSearch] = useState("");
  const [hydrating, setHydrating] = useState(true);
  const [dataSource, setDataSource] = useState<"supabase" | "error">("supabase");
  const [loadError, setLoadError] = useState("");

  const applyState = (state: AppStatePayload | null | undefined) => {
    if (!state) return false;
    if (state.ingredients) setIngredients(state.ingredients);
    if (state.drinks) setDrinks(state.drinks.map((d) => normalizeDrink(d)));
    if (state.settings) setSettings(normalizeSettings(state.settings));
    return Boolean(state.ingredients || state.drinks || state.settings);
  };

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const res = await fetch("/api/public-menu", { cache: "no-store" });
        const payload = (await res.json()) as {
          state?: AppStatePayload | null;
          error?: string;
        };

        if (!res.ok) {
          if (active) {
            setDataSource("error");
            setLoadError(payload.error ?? "Não foi possível carregar os dados públicos no Supabase.");
          }
          return;
        }

        if (active && applyState(payload.state)) {
          setDataSource("supabase");
          setLoadError("");
        } else if (active) {
          setDataSource("error");
          setLoadError("Não foi possível carregar os dados públicos no Supabase.");
        }
      } catch {
        if (active) {
          setDataSource("error");
          setLoadError("Erro ao consultar o Supabase para o cardápio público.");
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

        const price =
          settings.publicMenuPriceVisibility === "none"
            ? null
            : drink.publicMenuPriceMode === "manual"
            ? drink.manualPublicPrice ?? 0
            : drink.publicMenuPriceMode === "cmv"
            ? cmv
            : markup;

        return {
          drink,
          price,
          ingredientNames,
        };
      });
  }, [drinks, ingredients, search, settings]);

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
                {hydrating ? " • carregando..." : dataSource === "supabase" ? " • dados do Supabase" : " • erro ao carregar"}
              </div>
            </div>

            <Link href="/admin" style={{ textDecoration: "none", padding: "6px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel2)", color: "#7a8793", fontWeight: 600, fontSize: 12 }}>
              Ir para área interna
            </Link>
          </div>
        </div>

        <div style={card}>
          {loadError ? (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 12, border: "1px solid #f0c2c2", background: "#fff1f1", color: "#7b1f1f", fontSize: 12 }}>
              {loadError}
            </div>
          ) : null}

          <input
            style={input}
            placeholder="Buscar drink..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 220px))",
              justifyContent: "center",
              gap: 12,
            }}
          >
            {rows.map(({ drink, price, ingredientNames }) => (
              <div
                key={drink.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 16,
                  background: "white",
                  overflow: "hidden",
                  aspectRatio: "4 / 5",
                  display: "grid",
                  gridTemplateRows: "4fr 1fr",
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

                  {price !== null && (
                    <div style={{ marginTop: 5 }}>
                      <div style={{ fontSize: 13, fontWeight: 650 }}>{formatBRL(price)}</div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {rows.length === 0 && (
              <div style={{ padding: 14, border: "1px dashed var(--border)", borderRadius: 14, color: "var(--muted)", gridColumn: "1 / -1", background: "var(--panel2)" }}>
                Nenhum drink selecionado para o cardápio público.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
