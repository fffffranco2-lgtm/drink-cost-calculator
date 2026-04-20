/**
 * Tipos, constantes e funções puras compartilhadas entre as páginas do admin.
 * Separados de page.tsx para permitir importação pelos componentes de tab.
 */

import { clamp } from "@/lib/utils";

/* ---------------------- tipos básicos ---------------------- */

/** Unidades que a receita pode usar */
export type RecipeUnit = "ml" | "un" | "dash" | "drop";

/** Como precificar um ingrediente */
export type PricingModel = "by_ml" | "by_bottle" | "by_unit";

export type IngredientCategory =
  | "destilados_base"
  | "fortificados"
  | "licores"
  | "amaros_aperitivos"
  | "bitters"
  | "xaropes"
  | "citricos"
  | "sucos"
  | "mixers_carbonatados"
  | "garnish"
  | "outros";

export type PublicMenuDrinkPriceMode = "markup" | "cmv" | "manual";
export type PublicMenuPriceVisibility = "show" | "none";
export type CartaViewMode = "cards" | "list";
export type RecipeSortMode =
  | "alpha_asc"
  | "alpha_desc"
  | "price_asc"
  | "price_desc"
  | "cost_asc"
  | "cost_desc";

/** Arredondamento psicológico */
export type RoundingMode = "none" | "end_90" | "end_00" | "end_50";

/* ---------------------- entidades ---------------------- */

export type Ingredient = {
  id: string;
  name: string;
  category: IngredientCategory;
  pricingModel: PricingModel;

  // by_ml:
  costPerMl?: number; // R$/ml

  // by_bottle:
  bottlePrice?: number; // R$
  bottleMl?: number; // ml nominal
  yieldMl?: number; // ml utilizável real
  lossPct?: number; // 0-100 perdas adicionais

  // by_unit:
  costPerUnit?: number; // R$ por unidade

  notes?: string;
};

export type RecipeItem = {
  ingredientId: string;
  qty: number;
  unit: RecipeUnit;
};

export type DrinksPanelMode = "editor" | "pricing";

export type Drink = {
  id: string;
  name: string;
  items: RecipeItem[];
  notes?: string;
  preparationNotes?: string;
  photoDataUrl?: string; // base64 (data URL) da foto
  showOnPublicMenu?: boolean;
  publicMenuPriceMode?: PublicMenuDrinkPriceMode;
  manualPublicPrice?: number;
  // precificação interna por drink
  pricingMode?: PublicMenuDrinkPriceMode;
  markupMultiplier?: number;
  cmvTarget?: number;
};

export type Settings = {
  markup: number;
  targetCmv: number; // 0.2 = 20%
  dashMl: number; // ml por dash
  dropMl: number; // ml por gota
  publicMenuPriceVisibility: PublicMenuPriceVisibility;
  showPublicMenuGarnish: boolean;
  roundingMode: RoundingMode;
  publicMenuViewMode: CartaViewMode;
};

export type AppStatePayload = {
  ingredients: Ingredient[];
  drinks: Drink[];
  settings: Settings;
  activeDrinkId: string | null;
  activeIngredientId: string | null;
  tab: "carta" | "receitas" | "drinks" | "ingredients" | "settings" | "orders";
  cartaViewMode: CartaViewMode;
  drinksMode?: DrinksPanelMode;
};

export type ExportPayload = {
  ingredients: Ingredient[];
  drinks: Drink[];
  settings: Settings;
};

/* ---------------------- constantes ---------------------- */

export const INGREDIENT_CATEGORIES: IngredientCategory[] = [
  "destilados_base",
  "fortificados",
  "licores",
  "amaros_aperitivos",
  "bitters",
  "xaropes",
  "citricos",
  "sucos",
  "mixers_carbonatados",
  "garnish",
  "outros",
];

export const INGREDIENT_CATEGORY_LABEL: Record<IngredientCategory, string> = {
  destilados_base: "Destilados Base",
  fortificados: "Fortificados",
  licores: "Licores",
  amaros_aperitivos: "Amaros & Aperitivos",
  sucos: "Sucos",
  citricos: "Cítricos",
  mixers_carbonatados: "Mixers / Carbonatados",
  xaropes: "Xaropes",
  bitters: "Bitters",
  garnish: "Garnish",
  outros: "Outros",
};

export const DEFAULT_INGREDIENT_CATEGORY: IngredientCategory = "outros";

export const DEFAULT_SETTINGS: Settings = {
  markup: 4,
  targetCmv: 0.2,
  dashMl: 0.9,
  dropMl: 0.05,
  publicMenuPriceVisibility: "show",
  showPublicMenuGarnish: true,
  roundingMode: "end_90",
  publicMenuViewMode: "cards",
};

export const STORAGE_KEY = "mixologia_drink_cost_v4_menu_rounding";
export const REMOTE_SAVE_DEBOUNCE_MS = 1500;
export const LOCAL_SAVE_DEBOUNCE_MS = 1500;

/* ---------------------- utilitários puros ---------------------- */

/** Gera IDs únicos baseados em timestamp e aleatoriedade */
export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

/** Arredondamento psicológico de preço (sempre para cima ou igual) */
export function applyPsychRounding(price: number, mode: RoundingMode) {
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

/* ---------------------- cálculos de custo ---------------------- */

/** Calcula R$/ml de um ingrediente conforme seu modelo de precificação */
export function computeCostPerMl(ing: Ingredient): number | null {
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
  return null; // by_unit não tem R$/ml
}

export function computeItemCost(item: RecipeItem, ing: Ingredient | undefined, settings: Settings): number {
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

export function computeDrinkCost(drink: Drink, ingredients: Ingredient[], settings: Settings) {
  const map = new Map(ingredients.map((i) => [i.id, i]));
  let total = 0;
  for (const item of drink.items) {
    total += computeItemCost(item, map.get(item.ingredientId), settings);
  }
  return total;
}

/* ---------------------- normalização ---------------------- */

function parseOptionalNumber(raw: unknown): number | undefined {
  if (raw === "" || raw === null || raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function normalizeIngredientCategory(raw: unknown): IngredientCategory {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const legacyMap: Record<string, IngredientCategory> = {
    destilados: "destilados_base",
    vermutes: "fortificados",
    amaros: "amaros_aperitivos",
  };
  if (legacyMap[value]) return legacyMap[value];
  return (INGREDIENT_CATEGORIES as string[]).includes(value)
    ? (value as IngredientCategory)
    : DEFAULT_INGREDIENT_CATEGORY;
}

export function normalizeIngredient(raw: any): Ingredient {
  const pricingModel: PricingModel =
    raw?.pricingModel === "by_ml" || raw?.pricingModel === "by_unit" ? raw.pricingModel : "by_bottle";

  return {
    id: String(raw?.id || uid("ing")),
    name: String(raw?.name || "Ingrediente"),
    category: normalizeIngredientCategory(raw?.category),
    pricingModel,
    costPerMl: parseOptionalNumber(raw?.costPerMl),
    bottlePrice: parseOptionalNumber(raw?.bottlePrice),
    bottleMl: parseOptionalNumber(raw?.bottleMl),
    yieldMl: parseOptionalNumber(raw?.yieldMl),
    lossPct: parseOptionalNumber(raw?.lossPct),
    costPerUnit: parseOptionalNumber(raw?.costPerUnit),
    notes: raw?.notes ? String(raw.notes) : undefined,
  };
}

export function normalizeIngredients(raw: unknown): Ingredient[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => normalizeIngredient(item));
}

export function normalizeDrink(raw: any): Drink {
  const priceMode: PublicMenuDrinkPriceMode =
    raw?.publicMenuPriceMode === "cmv" || raw?.publicMenuPriceMode === "manual"
      ? raw.publicMenuPriceMode
      : "markup";
  const manualPublicPrice = Number(raw?.manualPublicPrice);

  return {
    ...raw,
    showOnPublicMenu: Boolean(raw?.showOnPublicMenu),
    publicMenuPriceMode: priceMode,
    manualPublicPrice: Number.isFinite(manualPublicPrice) ? manualPublicPrice : 0,
  };
}

export function normalizeSettings(raw: any): Settings {
  const visibility: PublicMenuPriceVisibility =
    raw?.publicMenuPriceVisibility === "none" || raw?.publicMenuPriceMode === "none" ? "none" : "show";
  const showPublicMenuGarnish =
    typeof raw?.showPublicMenuGarnish === "boolean"
      ? raw.showPublicMenuGarnish
      : typeof raw?.showPublicMenuGarnish === "string"
      ? raw.showPublicMenuGarnish.toLowerCase() !== "false"
      : true;

  const publicMenuViewMode: CartaViewMode =
    raw?.publicMenuViewMode === "list" ? "list" : "cards";

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    publicMenuPriceVisibility: visibility,
    showPublicMenuGarnish,
    publicMenuViewMode,
  };
}

/* ---------------------- formatação de receita ---------------------- */

function toDisplayUnit(unit: RecipeUnit) {
  return unit === "drop" ? "gota" : unit;
}

function formatQty(value: number, decimals: number) {
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(value * factor) / factor;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(decimals).replace(/\.?0+$/, "").replace(".", ",");
}

function sortRecipeItems(
  items: RecipeItem[],
  ingredientMap: Map<string, Ingredient>,
  options?: { hideGarnish?: boolean }
) {
  const hideGarnish = Boolean(options?.hideGarnish);
  const filtered = hideGarnish
    ? items.filter((item) => ingredientMap.get(item.ingredientId)?.category !== "garnish")
    : items;

  return [...filtered].sort((a, b) => {
    const group = (unit: RecipeUnit) => (unit === "ml" ? 0 : unit === "dash" ? 1 : 2);
    const groupDiff = group(a.unit) - group(b.unit);
    if (groupDiff !== 0) return groupDiff;

    if (a.qty !== b.qty) return b.qty - a.qty;

    const nameA = ingredientMap.get(a.ingredientId)?.name ?? "";
    const nameB = ingredientMap.get(b.ingredientId)?.name ?? "";
    return nameA.localeCompare(nameB, "pt-BR");
  });
}

export function formatRecipeItemsForDisplay(
  items: RecipeItem[],
  ingredientMap: Map<string, Ingredient>,
  options?: { hideGarnish?: boolean; garnishTag?: boolean }
) {
  const garnishTag = Boolean(options?.garnishTag);
  return sortRecipeItems(items, ingredientMap, options)
    .map((item) => {
      const ingredient = ingredientMap.get(item.ingredientId);
      const name = ingredient?.name?.trim();
      if (!name) return null;

      const unit = toDisplayUnit(item.unit);
      const decimals = item.unit === "ml" ? 0 : 2;
      const qty = formatQty(item.qty, decimals);
      const garnishSuffix = garnishTag && ingredient?.category === "garnish" ? " (garnish)" : "";
      const dashSuffix = item.qty > 1 ? "dashes" : "dash";
      const qtyWithUnit = item.unit === "dash" ? `${qty} ${dashSuffix}` : `${qty}${unit}`;
      return `${qtyWithUnit} ${name}${garnishSuffix}`;
    })
    .filter((entry): entry is string => Boolean(entry));
}

/* ---------------------- estilos compartilhados ---------------------- */

export const FONT_SCALE = {
  sm: 12,
  md: 14,
  lg: 18,
} as const;

export function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    backgroundColor: active ? "var(--pillActive)" : "var(--pill)",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  };
}

export function compactPillStyle(active: boolean): React.CSSProperties {
  return {
    ...pillStyle(active),
    padding: "4px 6px",
    fontSize: FONT_SCALE.sm,
    fontWeight: 600,
    textAlign: "center",
    width: "100%",
    minWidth: 0,
  };
}

export const adminCard: React.CSSProperties = {
  backgroundColor: "var(--panel)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  borderRadius: 18,
  padding: 16,
  boxShadow: "var(--shadow)",
};

export const adminHeaderCard: React.CSSProperties = {
  ...adminCard,
  backgroundColor: "var(--panel2)",
};

export const adminBtn: React.CSSProperties = {
  padding: "10px 13px",
  borderRadius: 12,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  backgroundColor: "var(--btn)",
  cursor: "pointer",
  fontWeight: 600,
};

export const adminBtnDanger: React.CSSProperties = {
  ...adminBtn,
  backgroundColor: "var(--danger)",
  borderColor: "var(--dangerBorder)",
};

export const adminIconBtn: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  backgroundColor: "var(--btn)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  fontSize: FONT_SCALE.md,
  fontWeight: 700,
  lineHeight: 1,
};

export const adminIconBtnDanger: React.CSSProperties = {
  ...adminIconBtn,
  backgroundColor: "var(--danger)",
  borderColor: "var(--dangerBorder)",
};

export const adminInput: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 12,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  background: "white",
  outline: "none",
};

export const adminSmall: React.CSSProperties = { fontSize: FONT_SCALE.sm, color: "var(--muted)" };

export function adminTopTab(active: boolean): React.CSSProperties {
  return {
    ...adminBtn,
    backgroundColor: active ? "var(--pillActive)" : "var(--pill)",
  };
}

export function adminCategoryButtonStyle(active: boolean, isAdd = false): React.CSSProperties {
  return {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    backgroundColor: active ? "var(--pillActive)" : "var(--pill)",
    borderRadius: 12,
    padding: isAdd ? "8px 10px" : "8px 16px",
    fontSize: FONT_SCALE.sm,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
    textAlign: "center",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

export function adminIngredientButtonStyle(active: boolean): React.CSSProperties {
  return {
    ...pillStyle(active),
    borderRadius: 12,
    fontSize: FONT_SCALE.sm,
    fontWeight: 600,
  };
}
