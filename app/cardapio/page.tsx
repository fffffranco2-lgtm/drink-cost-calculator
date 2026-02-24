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

const STORAGE_KEY = "mixologia_drink_cost_v4_menu_rounding";
const DEFAULT_SETTINGS: Settings = {
  markup: 4,
  targetCmv: 0.2,
  dashMl: 0.9,
  dropMl: 0.05,
  publicMenuPriceVisibility: "show",
  roundingMode: "end_90",
};

function normalizeDrink(raw: any): Drink {
  const priceMode: PublicMenuDrinkPriceMode =
    raw?.publicMenuPriceMode === "cmv" || raw?.publicMenuPriceMode === "manual" ? raw.publicMenuPriceMode : "markup";
  const manualPublicPrice = Number(raw?.manualPublicPrice);

  return {
    ...raw,
    showOnPublicMenu: Boolean(raw?.showOnPublicMenu),
    publicMenuPriceMode: priceMode,
    manualPublicPrice: Number.isFinite(manualPublicPrice) ? manualPublicPrice : 0,
  };
}

function normalizeSettings(raw: any): Settings {
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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.ingredients) setIngredients(parsed.ingredients);
      if (parsed?.drinks) setDrinks((parsed.drinks as any[]).map((d) => normalizeDrink(d)));
      if (parsed?.settings) setSettings(normalizeSettings(parsed.settings));
    } catch {}
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return drinks
      .filter((d) => d.showOnPublicMenu)
      .filter((d) => (q ? d.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((drink) => {
        const cost = computeDrinkCost(drink, ingredients, settings);
        const markup = applyPsychRounding(cost * settings.markup, settings.roundingMode);
        const cmv = settings.targetCmv > 0 ? applyPsychRounding(cost / settings.targetCmv, settings.roundingMode) : 0;

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
        };
      });
  }, [drinks, ingredients, search, settings]);

  const page: React.CSSProperties = {
    background: "#fbf7f0",
    minHeight: "100vh",
    color: "#2b2b2b",
    padding: 24,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  };

  const container: React.CSSProperties = { maxWidth: 1160, margin: "0 auto" };

  const card: React.CSSProperties = {
    background: "#fffdf9",
    border: "1px solid #e7e1d8",
    borderRadius: 18,
    padding: 16,
    boxShadow: "0 6px 24px rgba(30, 30, 30, 0.06)",
  };

  const input: React.CSSProperties = {
    width: "100%",
    padding: 10,
    borderRadius: 12,
    border: "1px solid #e7e1d8",
    background: "white",
    outline: "none",
  };

  const small: React.CSSProperties = { fontSize: 12, color: "#6a6a6a" };

  return (
    <div style={page}>
      <div style={container}>
        <div style={{ ...card, marginBottom: 14, background: "linear-gradient(180deg, #fffdf9 0%, #fff7ee 100%)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, letterSpacing: -0.2 }}>Cardápio de Drinks</h1>
              <div style={small}>Seção pública com drinks selecionados</div>
            </div>

            <Link href="/admin" style={{ textDecoration: "none", padding: "10px 12px", borderRadius: 12, border: "1px solid #e7e1d8", background: "#f6efe6", color: "inherit" }}>
              Ir para área interna
            </Link>
          </div>
        </div>

        <div style={card}>
          <input
            style={input}
            placeholder="Buscar drink..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {rows.map(({ drink, price }) => (
              <div key={drink.id} style={{ border: "1px solid #e7e1d8", borderRadius: 16, background: "white", overflow: "hidden" }}>
                <div
                  style={{
                    height: 140,
                    background: "#fff7ee",
                    borderBottom: "1px solid #e7e1d8",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#6a6a6a",
                    fontSize: 12,
                  }}
                >
                  {drink.photoDataUrl ? (
                    <img src={drink.photoDataUrl} alt={drink.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    "Sem foto"
                  )}
                </div>

                <div style={{ padding: 12 }}>
                  <div style={{ fontSize: 16, fontWeight: 650 }}>{drink.name}</div>
                  {drink.notes ? <div style={{ ...small, marginTop: 4 }}>{drink.notes}</div> : null}

                  {price !== null && (
                    <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={small}>Preço</div>
                      <div style={{ fontSize: 17, fontWeight: 650 }}>{formatBRL(price)}</div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {rows.length === 0 && (
              <div style={{ padding: 14, border: "1px dashed #e7e1d8", borderRadius: 14, color: "#6a6a6a", gridColumn: "1 / -1" }}>
                Nenhum drink selecionado para o cardápio público.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
