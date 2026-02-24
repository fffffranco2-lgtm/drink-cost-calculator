"use client";

import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Unidades que a receita pode usar */
type RecipeUnit = "ml" | "un" | "dash" | "drop";

/** Como precificar um ingrediente */
type PricingModel = "by_ml" | "by_bottle" | "by_unit";

type PublicMenuDrinkPriceMode = "markup" | "cmv" | "manual";
type PublicMenuPriceVisibility = "show" | "none";
type CartaViewMode = "cards" | "list";

/** Arredondamento psicológico */
type RoundingMode = "none" | "end_90" | "end_00" | "end_50";

type Ingredient = {
  id: string;
  name: string;

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

type RecipeItem = {
  ingredientId: string;
  qty: number;
  unit: RecipeUnit; // ml | un | dash | drop
};

type Drink = {
  id: string;
  name: string;
  items: RecipeItem[];
  notes?: string;
  photoDataUrl?: string; // base64 (data URL) da foto
  showOnPublicMenu?: boolean;
  publicMenuPriceMode?: PublicMenuDrinkPriceMode;
  manualPublicPrice?: number;
};

type Settings = {
  markup: number;
  targetCmv: number; // 0.2 = 20%
  dashMl: number; // ml por dash (normalmente fracionário)
  dropMl: number; // ml por gota (normalmente fracionário)
  publicMenuPriceVisibility: PublicMenuPriceVisibility;
  roundingMode: RoundingMode; // arredondamento psicológico
};

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

/* ----------------------------- utils ----------------------------- */

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function makeCopyName(baseName: string, existingNames: string[]) {
  const trimmed = baseName.trim();
  const normalized = trimmed.replace(/\s*\(cópia(\s\d+)?\)$/i, "");
  const root = normalized || "Sem nome";

  const nameSet = new Set(existingNames);
  const firstCopy = `${root} (cópia)`;
  if (!nameSet.has(firstCopy)) return firstCopy;

  let index = 2;
  while (nameSet.has(`${root} (cópia ${index})`)) index += 1;
  return `${root} (cópia ${index})`;
}

/** parse pt-BR input; allow empty */
function parseNumberLoose(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const norm = t.replace(/\./g, "").replace(",", "."); // allow 1.234,56
  const v = Number(norm);
  return Number.isFinite(v) ? v : null;
}

/** format number for input */
function formatFixed(n: number, decimals: number) {
  return n.toFixed(decimals).replace(".", ",");
}

/** arredondamento psicológico para preço (sempre para cima ou igual) */
function applyPsychRounding(price: number, mode: RoundingMode) {
  if (!Number.isFinite(price)) return 0;
  if (mode === "none") return price;

  const integer = Math.floor(price);
  const frac = price - integer;

  if (mode === "end_00") {
    // próximo inteiro (ou igual)
    return frac === 0 ? price : integer + 1;
  }

  const targetFrac = mode === "end_90" ? 0.9 : 0.5;
  const candidate = integer + targetFrac;
  if (price <= candidate + 1e-9) return candidate; // já cabe no mesmo inteiro
  return integer + 1 + targetFrac; // sobe pro próximo
}

/** compressão das imagens */
async function fileToDataUrlResized(
  file: File,
  opts: { maxWidth: number; maxHeight: number; quality: number }
): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Falha ao carregar imagem"));
    i.src = dataUrl;
  });

  const { maxWidth, maxHeight, quality } = opts;
  const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  ctx.drawImage(img, 0, 0, w, h);

  // JPEG costuma ficar bem mais leve que PNG
  return canvas.toDataURL("image/jpeg", quality);
}

/* --------------------------- calculations --------------------------- */

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
  return null; // by_unit não tem R$/ml
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

/* ------------------------------ CSV ------------------------------ */

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type ExportPayload = {
  ingredients: Ingredient[];
  drinks: Drink[];
  settings: Settings;
};

type AppStatePayload = {
  ingredients: Ingredient[];
  drinks: Drink[];
  settings: Settings;
  activeDrinkId: string | null;
  activeIngredientId: string | null;
  tab: "carta" | "receitas" | "drinks" | "ingredients" | "settings";
  cartaViewMode: CartaViewMode;
};

function exportAsCsv(payload: ExportPayload) {
  const ingredientsRows = payload.ingredients.map((i) => ({
    id: i.id,
    name: i.name,
    pricingModel: i.pricingModel,
    costPerMl: i.costPerMl ?? "",
    bottlePrice: i.bottlePrice ?? "",
    bottleMl: i.bottleMl ?? "",
    yieldMl: i.yieldMl ?? "",
    lossPct: i.lossPct ?? "",
    costPerUnit: i.costPerUnit ?? "",
    notes: i.notes ?? "",
  }));

  const drinkRows: any[] = [];
  for (const d of payload.drinks) {
    drinkRows.push({
      kind: "drink",
      id: d.id,
      name: d.name,
      notes: d.notes ?? "",
      showOnPublicMenu: d.showOnPublicMenu ? "true" : "false",
      publicMenuPriceMode: d.publicMenuPriceMode ?? "markup",
      manualPublicPrice: d.manualPublicPrice ?? 0,
      ingredientId: "",
      qty: "",
      unit: "",
    });
    d.items.forEach((it, idx) => {
      drinkRows.push({
        kind: "item",
        id: d.id,
        ingredientId: it.ingredientId,
        qty: it.qty,
        unit: it.unit,
        itemIndex: idx,
      });
    });
  }

  const settingsRow = [
    {
      markup: payload.settings.markup,
      targetCmv: payload.settings.targetCmv,
      dashMl: payload.settings.dashMl,
      dropMl: payload.settings.dropMl,
      publicMenuPriceVisibility: payload.settings.publicMenuPriceVisibility,
      roundingMode: payload.settings.roundingMode,
    },
  ];

  const combined =
    `###INGREDIENTS###\n${Papa.unparse(ingredientsRows)}\n\n` +
    `###DRINKS###\n${Papa.unparse(drinkRows)}\n\n` +
    `###SETTINGS###\n${Papa.unparse(settingsRow)}\n`;

  downloadTextFile("mixologia_export.csv", combined);
}

function parseCombinedCsv(text: string): Partial<ExportPayload> {
  const sections = new Map<string, string>();
  const markers = ["###INGREDIENTS###", "###DRINKS###", "###SETTINGS###"];

  let current: string | null = null;
  const lines = text.split(/\r?\n/);
  const buffers: Record<string, string[]> = {};

  for (const line of lines) {
    const marker = markers.find((m) => line.trim() === m);
    if (marker) {
      current = marker;
      buffers[current] = [];
      continue;
    }
    if (current) buffers[current].push(line);
  }

  for (const m of markers) {
    if (buffers[m]) sections.set(m, buffers[m].join("\n").trim());
  }

  const out: Partial<ExportPayload> = {};

  const ingText = sections.get("###INGREDIENTS###");
  if (ingText) {
    const parsed = Papa.parse<any>(ingText, { header: true, skipEmptyLines: true });
    out.ingredients = (parsed.data || []).map((r) => ({
      id: String(r.id || uid("ing")),
      name: String(r.name || "Ingrediente"),
      pricingModel: (r.pricingModel as PricingModel) || "by_bottle",
      costPerMl: r.costPerMl === "" ? undefined : Number(r.costPerMl),
      bottlePrice: r.bottlePrice === "" ? undefined : Number(r.bottlePrice),
      bottleMl: r.bottleMl === "" ? undefined : Number(r.bottleMl),
      yieldMl: r.yieldMl === "" ? undefined : Number(r.yieldMl),
      lossPct: r.lossPct === "" ? undefined : Number(r.lossPct),
      costPerUnit: r.costPerUnit === "" ? undefined : Number(r.costPerUnit),
      notes: r.notes ? String(r.notes) : undefined,
    })) as Ingredient[];
  }

  const drinksText = sections.get("###DRINKS###");
  if (drinksText) {
    const parsed = Papa.parse<any>(drinksText, { header: true, skipEmptyLines: true });
    const rows = parsed.data || [];

    const byDrink = new Map<string, Drink>();
    for (const r of rows) {
      if (String(r.kind || "").trim() !== "drink") continue;
      const id = String(r.id || "").trim();
      if (!id) continue;
      byDrink.set(id, {
        id,
        name: String(r.name || "Drink"),
        notes: r.notes ? String(r.notes) : undefined,
        showOnPublicMenu: String(r.showOnPublicMenu || "").toLowerCase() === "true",
        publicMenuPriceMode:
          String(r.publicMenuPriceMode || "").toLowerCase() === "cmv"
            ? "cmv"
            : String(r.publicMenuPriceMode || "").toLowerCase() === "manual"
            ? "manual"
            : "markup",
        manualPublicPrice: Number(r.manualPublicPrice || 0),
        items: [],
      });
    }

    for (const r of rows) {
      if (String(r.kind || "").trim() !== "item") continue;
      const id = String(r.id || "").trim();
      const d = byDrink.get(id);
      if (!d) continue;

      const ingredientId = String(r.ingredientId || "").trim();
      const qty = Number(r.qty);
      const unit = (String(r.unit || "ml") as RecipeUnit) || "ml";
      if (!ingredientId || !Number.isFinite(qty)) continue;

      d.items.push({ ingredientId, qty, unit });
    }

    out.drinks = Array.from(byDrink.values()).map((d) => normalizeDrink(d));
  }

  const settingsText = sections.get("###SETTINGS###");
  if (settingsText) {
    const parsed = Papa.parse<any>(settingsText, { header: true, skipEmptyLines: true });
    const r = (parsed.data || [])[0];
    if (r) {
      out.settings = normalizeSettings({
        markup: Number(r.markup ?? 4),
        targetCmv: Number(r.targetCmv ?? 0.2),
        dashMl: Number(r.dashMl ?? 0.9),
        dropMl: Number(r.dropMl ?? 0.05),
        publicMenuPriceVisibility: r.publicMenuPriceVisibility,
        publicMenuPriceMode: r.publicMenuPriceMode,
        roundingMode: (r.roundingMode as RoundingMode) || "none",
      });
    }
  }

  return out;
}

/* ------------------------- numeric input ------------------------- */

function NumberField(props: {
  value: number;
  onCommit: (n: number) => void;
  decimals: number; // 2 para preço; 0 para ml
  min?: number;
  max?: number;
  style?: React.CSSProperties;
  inputMode?: "decimal" | "numeric";
}) {
  const { value, onCommit, decimals, min, max, style, inputMode } = props;
  const [text, setText] = useState<string>(formatFixed(value, decimals));
  const [focused, setFocused] = useState(false);

  // sync from outside when not editing
  useEffect(() => {
    if (!focused) setText(formatFixed(value, decimals));
  }, [value, decimals, focused]);

  const commit = () => {
    const parsed = parseNumberLoose(text);
    if (parsed === null) {
      // volta pro valor atual se vazio/ inválido
      setText(formatFixed(value, decimals));
      return;
    }
    let n = parsed;
    if (typeof min === "number") n = Math.max(min, n);
    if (typeof max === "number") n = Math.min(max, n);

    // normalize decimals
    const factor = Math.pow(10, decimals);
    n = Math.round(n * factor) / factor;

    onCommit(n);
    setText(formatFixed(n, decimals));
  };

  return (
    <input
      style={style}
      inputMode={inputMode ?? "decimal"}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setText(formatFixed(value, decimals));
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/* ------------------------------ UI ------------------------------ */

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 999,
    border: "1px solid var(--border)",
    background: active ? "var(--pillActive)" : "var(--pill)",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  };
}

export default function Page() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [hydratingRemote, setHydratingRemote] = useState(true);
  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [remoteError, setRemoteError] = useState<string>("");

  const [tab, setTab] = useState<"receitas" | "drinks" | "ingredients" | "settings">("receitas");
  const [activeDrinkId, setActiveDrinkId] = useState<string | null>(null);
  const [activeIngredientId, setActiveIngredientId] = useState<string | null>(null);

  const [menuSearch, setMenuSearch] = useState("");
  const [cartaViewMode, setCartaViewMode] = useState<CartaViewMode>("cards");

  useEffect(() => {
    let active = true;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) return;
      if (!user) {
        window.location.href = "/admin/login";
        return;
      }

      setAdminUserId(user.id);

      const { data, error } = await supabase.from("app_state").select("state").eq("user_id", user.id).maybeSingle();
      if (!active) return;

      if (error) {
        setRemoteError("Falha ao carregar dados do Supabase.");
        setHydratingRemote(false);
        return;
      }

      const state = data?.state as Partial<AppStatePayload> | undefined;
      if (state) {
        if (state.ingredients) setIngredients(state.ingredients);
        if (state.drinks) setDrinks((state.drinks as any[]).map((d) => normalizeDrink(d)));
        if (state.settings) setSettings(normalizeSettings(state.settings));
        if (state.activeDrinkId) setActiveDrinkId(state.activeDrinkId);
        if (state.activeIngredientId) setActiveIngredientId(state.activeIngredientId);
        if (state.tab) setTab(state.tab === "carta" ? "receitas" : state.tab);
        if (state.cartaViewMode === "cards" || state.cartaViewMode === "list") {
          setCartaViewMode(state.cartaViewMode);
        }
      }

      setHydratingRemote(false);
    })();

    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (hydratingRemote || !adminUserId) return;

    const timeout = setTimeout(async () => {
      const state: AppStatePayload = {
        ingredients,
        drinks,
        settings,
        activeDrinkId,
        activeIngredientId,
        tab,
        cartaViewMode,
      };

      const { error } = await supabase
        .from("app_state")
        .upsert({ user_id: adminUserId, state, updated_at: new Date().toISOString() });

      if (error) setRemoteError("Falha ao salvar alterações no Supabase.");
    }, 700);

    return () => clearTimeout(timeout);
  }, [
    hydratingRemote,
    adminUserId,
    ingredients,
    drinks,
    settings,
    activeDrinkId,
    activeIngredientId,
    tab,
    cartaViewMode,
    supabase,
  ]);

  // seed: 3 drinks
  useEffect(() => {
    if (hydratingRemote || ingredients.length || drinks.length) return;

    const gin: Ingredient = { id: uid("ing"), name: "Gin (750ml)", pricingModel: "by_bottle", bottlePrice: 120, bottleMl: 750, yieldMl: 720, lossPct: 0 };
    const vodka: Ingredient = { id: uid("ing"), name: "Vodka (750ml)", pricingModel: "by_bottle", bottlePrice: 95, bottleMl: 750, yieldMl: 720, lossPct: 0 };
    const campari: Ingredient = { id: uid("ing"), name: "Campari (750ml)", pricingModel: "by_bottle", bottlePrice: 110, bottleMl: 750, yieldMl: 720, lossPct: 0 };
    const vermuteRosso: Ingredient = { id: uid("ing"), name: "Vermute Rosso (1L)", pricingModel: "by_bottle", bottlePrice: 80, bottleMl: 1000, yieldMl: 950, lossPct: 0 };
    const lillet: Ingredient = { id: uid("ing"), name: "Lillet Blanc (750ml)", pricingModel: "by_bottle", bottlePrice: 140, bottleMl: 750, yieldMl: 720, lossPct: 0 };
    const angostura: Ingredient = { id: uid("ing"), name: "Angostura (bitters)", pricingModel: "by_bottle", bottlePrice: 70, bottleMl: 200, yieldMl: 190, lossPct: 0 };
    const orangePeel: Ingredient = { id: uid("ing"), name: "Casca de laranja (garnish)", pricingModel: "by_unit", costPerUnit: 0.4 };
    const lemonPeel: Ingredient = { id: uid("ing"), name: "Casca de limão (garnish)", pricingModel: "by_unit", costPerUnit: 0.35 };

    const hanky: Drink = {
      id: uid("drink"),
      name: "Hanky Panky",
      showOnPublicMenu: true,
      publicMenuPriceMode: "markup",
      manualPublicPrice: 0,
      items: [
        { ingredientId: gin.id, qty: 45, unit: "ml" },
        { ingredientId: vermuteRosso.id, qty: 45, unit: "ml" },
        { ingredientId: angostura.id, qty: 1, unit: "dash" },
        { ingredientId: orangePeel.id, qty: 1, unit: "un" },
      ],
    };

    const negroni: Drink = {
      id: uid("drink"),
      name: "Negroni",
      showOnPublicMenu: true,
      publicMenuPriceMode: "cmv",
      manualPublicPrice: 0,
      items: [
        { ingredientId: gin.id, qty: 30, unit: "ml" },
        { ingredientId: campari.id, qty: 30, unit: "ml" },
        { ingredientId: vermuteRosso.id, qty: 30, unit: "ml" },
        { ingredientId: orangePeel.id, qty: 1, unit: "un" },
      ],
    };

    const vesper: Drink = {
      id: uid("drink"),
      name: "Vesper (teste)",
      showOnPublicMenu: false,
      publicMenuPriceMode: "manual",
      manualPublicPrice: 39.9,
      items: [
        { ingredientId: gin.id, qty: 60, unit: "ml" },
        { ingredientId: vodka.id, qty: 15, unit: "ml" },
        { ingredientId: lillet.id, qty: 8, unit: "ml" }, // ml inteiro
        { ingredientId: lemonPeel.id, qty: 1, unit: "un" },
      ],
    };

    const ingList = [gin, vodka, campari, vermuteRosso, lillet, angostura, orangePeel, lemonPeel];
    const drinkList = [hanky, negroni, vesper];

    setIngredients(ingList);
    setDrinks(drinkList);
    setActiveDrinkId(drinkList[0].id);
    setActiveIngredientId(ingList[0].id);
  }, [hydratingRemote, ingredients.length, drinks.length]);

  // keep active selections valid
  useEffect(() => {
    if (!drinks.length) {
      setActiveDrinkId(null);
      return;
    }
    if (!activeDrinkId || !drinks.some((d) => d.id === activeDrinkId)) {
      setActiveDrinkId(drinks[0].id);
    }
  }, [drinks, activeDrinkId]);

  useEffect(() => {
    if (!ingredients.length) {
      setActiveIngredientId(null);
      return;
    }
    if (!activeIngredientId || !ingredients.some((i) => i.id === activeIngredientId)) {
      setActiveIngredientId(ingredients[0].id);
    }
  }, [ingredients, activeIngredientId]);

  const ingredientMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const computedByDrinkId = useMemo(() => {
    const map = new Map<string, { cost: number; priceMarkup: number; priceCmv: number }>();
    for (const d of drinks) {
      const cost = computeDrinkCost(d, ingredients, settings);
      const priceMarkup = cost * settings.markup;
      const priceCmv = settings.targetCmv > 0 ? cost / settings.targetCmv : 0;
      map.set(d.id, { cost, priceMarkup, priceCmv });
    }
    return map;
  }, [drinks, ingredients, settings]);

  const activeDrink = useMemo(
    () => (activeDrinkId ? drinks.find((d) => d.id === activeDrinkId) ?? null : null),
    [drinks, activeDrinkId]
  );

  const activeIngredient = useMemo(
    () => (activeIngredientId ? ingredients.find((i) => i.id === activeIngredientId) ?? null : null),
    [ingredients, activeIngredientId]
  );

  // CRUD
  const addIngredient = () => {
    const ing: Ingredient = {
      id: uid("ing"),
      name: "Novo ingrediente",
      pricingModel: "by_bottle",
      bottlePrice: 0,
      bottleMl: 750,
      yieldMl: 750,
      lossPct: 0,
    };
    setIngredients((p) => [ing, ...p]);
    setTab("ingredients");
    setActiveIngredientId(ing.id);
  };

  const updateIngredient = (id: string, patch: Partial<Ingredient>) => {
    setIngredients((p) => p.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const removeIngredient = (id: string) => {
    setIngredients((p) => p.filter((i) => i.id !== id));
    setDrinks((p) => p.map((d) => ({ ...d, items: d.items.filter((it) => it.ingredientId !== id) })));
  };

  const duplicateIngredient = (ingredientId: string) => {
    const original = ingredients.find((i) => i.id === ingredientId);
    if (!original) return;

    const duplicateName = makeCopyName(
      original.name,
      ingredients.map((i) => i.name)
    );

    const duplicated: Ingredient = {
      ...original,
      id: uid("ing"),
      name: duplicateName,
    };

    setIngredients((p) => [duplicated, ...p]);
    setTab("ingredients");
    setActiveIngredientId(duplicated.id);
  };

  const addDrink = () => {
    const d: Drink = {
      id: uid("drink"),
      name: "Novo drink",
      items: [],
      showOnPublicMenu: false,
      publicMenuPriceMode: "markup",
      manualPublicPrice: 0,
    };
    setDrinks((p) => [d, ...p]);
    setTab("drinks");
    setActiveDrinkId(d.id);
  };

  const duplicateDrink = (drinkId: string) => {
    const original = drinks.find((d) => d.id === drinkId);
    if (!original) return;

    const duplicateName = makeCopyName(
      original.name,
      drinks.map((d) => d.name)
    );

    const duplicated: Drink = {
      ...original,
      id: uid("drink"),
      name: duplicateName,
      items: original.items.map((item) => ({ ...item })),
    };

    setDrinks((p) => [duplicated, ...p]);
    setTab("drinks");
    setActiveDrinkId(duplicated.id);
  };

  const updateDrink = (id: string, patch: Partial<Drink>) => {
    setDrinks((p) => p.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const removeDrink = (id: string) => {
    setDrinks((p) => p.filter((d) => d.id !== id));
  };

  const addItemToDrink = (drinkId: string) => {
    const first = ingredients[0];
    if (!first) return;
    setDrinks((p) =>
      p.map((d) => (d.id === drinkId ? { ...d, items: [...d.items, { ingredientId: first.id, qty: 0, unit: "ml" }] } : d))
    );
  };

  const updateItem = (drinkId: string, idx: number, patch: Partial<RecipeItem>) => {
    setDrinks((p) =>
      p.map((d) => {
        if (d.id !== drinkId) return d;
        const items = d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
        return { ...d, items };
      })
    );
  };

  const removeItem = (drinkId: string, idx: number) => {
    setDrinks((p) =>
      p.map((d) => {
        if (d.id !== drinkId) return d;
        return { ...d, items: d.items.filter((_, i) => i !== idx) };
      })
    );
  };

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/admin/login";
  };

  /* ------------------------------ Theme ------------------------------ */

  const themeVars: React.CSSProperties = {
    ["--bg" as any]: "#fbf7f0",
    ["--panel" as any]: "#fffdf9",
    ["--panel2" as any]: "#fff7ee",
    ["--pill" as any]: "#fff3e9",
    ["--pillActive" as any]: "#f2f7ff",
    ["--ink" as any]: "#2b2b2b",
    ["--muted" as any]: "#6a6a6a",
    ["--border" as any]: "#e7e1d8",
    ["--shadow" as any]: "0 6px 24px rgba(30, 30, 30, 0.06)",
    ["--btn" as any]: "#f6efe6",
    ["--danger" as any]: "#fff0f0",
    ["--dangerBorder" as any]: "#f2caca",
    ["--focus" as any]: "rgba(109, 157, 255, 0.35)",
  };

  const page: React.CSSProperties = {
    ...themeVars,
    background: "var(--bg)",
    minHeight: "100vh",
    color: "var(--ink)",
    padding: 24,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  };

  const container: React.CSSProperties = { maxWidth: 1160, margin: "0 auto" };

  const card: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 18,
    padding: 16,
    boxShadow: "var(--shadow)",
  };

  const headerCard: React.CSSProperties = {
    ...card,
    background: "linear-gradient(180deg, var(--panel) 0%, var(--panel2) 100%)",
  };

  const btn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--btn)",
    cursor: "pointer",
  };

  const btnDanger: React.CSSProperties = {
    ...btn,
    background: "var(--danger)",
    borderColor: "var(--dangerBorder)",
  };

  const input: React.CSSProperties = {
    width: "100%",
    padding: 10,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "white",
    outline: "none",
  };

  const small: React.CSSProperties = { fontSize: 12, color: "var(--muted)" };

  const topTab = (active: boolean): React.CSSProperties => ({
    ...btn,
    background: active ? "var(--pillActive)" : "var(--pill)",
  });

  const focusStyle = `
    input:focus, textarea:focus, select:focus {
      box-shadow: 0 0 0 4px var(--focus);
      border-color: #b8ccff;
    }
  `;

  /* ------------------------------ Views ------------------------------ */

  function getFinalPriceForDrink(dId: string): { label: string; value: number }[] {
    const c = computedByDrinkId.get(dId);
    if (!c) return [];
    return [
      { label: `Markup ${settings.markup}x`, value: applyPsychRounding(c.priceMarkup, settings.roundingMode) },
      { label: `CMV ${Math.round(settings.targetCmv * 100)}%`, value: applyPsychRounding(c.priceCmv, settings.roundingMode) },
    ];
  }

  function getPublicMenuPriceForDrink(d: Drink): number {
    const c = computedByDrinkId.get(d.id);
    if (!c) return 0;
    if (d.publicMenuPriceMode === "manual") return d.manualPublicPrice ?? 0;
    if (d.publicMenuPriceMode === "cmv") return applyPsychRounding(c.priceCmv, settings.roundingMode);
    return applyPsychRounding(c.priceMarkup, settings.roundingMode);
  }

  const cartaRows = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    return [...drinks]
      .filter((d) => (q ? d.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({ d, prices: getFinalPriceForDrink(d.id), publicPrice: getPublicMenuPriceForDrink(d) }));
  }, [drinks, menuSearch, computedByDrinkId, settings.roundingMode, settings.markup, settings.targetCmv]);

  return (
    <div style={page}>
      <style>{focusStyle}</style>

      <div style={container}>
        <div style={{ ...headerCard, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, letterSpacing: -0.2 }}>Custos de Drinks</h1>
              <div style={small}>Área interna da operação • Arredondamento psicológico • Inputs numéricos editáveis</div>
              {remoteError ? <div style={{ ...small, color: "#b00020", marginTop: 4 }}>{remoteError}</div> : null}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button style={btn} onClick={addDrink}>+ Drink</button>
              <button style={btn} onClick={addIngredient}>+ Ingrediente</button>

              <button style={btn} onClick={() => exportAsCsv({ ingredients, drinks, settings })}>
                Exportar CSV
              </button>

              <Link href="/" style={{ ...btn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                Cardápio público
              </Link>
              <button style={btn} onClick={logout}>
                Sair
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button style={topTab(tab === "receitas")} onClick={() => setTab("receitas")}>Receitas</button>
            <button style={topTab(tab === "drinks")} onClick={() => setTab("drinks")}>Drinks</button>
            <button style={topTab(tab === "ingredients")} onClick={() => setTab("ingredients")}>Ingredientes</button>
            <button style={topTab(tab === "settings")} onClick={() => setTab("settings")}>Configurações</button>
          </div>
        </div>

        {/* -------------------- RECEITAS -------------------- */}
        {tab === "receitas" && (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ marginTop: 0, fontSize: 16, marginBottom: 10 }}>Receitas</h2>
              <div style={small}>
                Arredondamento: {settings.roundingMode === "none" ? "Nenhum" : settings.roundingMode === "end_90" ? ",90" : settings.roundingMode === "end_00" ? ",00" : ",50"}
              </div>
            </div>

            <input
              style={input}
              placeholder="Buscar drink..."
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
            />

            <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={small}>Visualização das Receitas</div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={pillStyle(cartaViewMode === "cards")} onClick={() => setCartaViewMode("cards")}>
                  Cards (com foto)
                </div>
                <div style={pillStyle(cartaViewMode === "list")} onClick={() => setCartaViewMode("list")}>
                  Lista (sem foto)
                </div>
              </div>
            </div>

            <div
              style={
                cartaViewMode === "cards"
                  ? { marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }
                  : { marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }
              }
            >
              {cartaRows.map(({ d, prices, publicPrice }) =>
                cartaViewMode === "cards" ? (
                  <div key={d.id} style={{ border: "1px solid var(--border)", borderRadius: 16, background: "white", overflow: "hidden" }}>
                    <div
                      style={{
                        height: 140,
                        background: "var(--panel2)",
                        borderBottom: "1px solid var(--border)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--muted)",
                        fontSize: 12,
                      }}
                    >
                      {d.photoDataUrl ? (
                        <img src={d.photoDataUrl} alt={d.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        "Sem foto"
                      )}
                    </div>

                    <div style={{ padding: 12 }}>
                      <div style={{ fontSize: 16, fontWeight: 650 }}>{d.name}</div>
                      {d.notes ? <div style={{ ...small, marginTop: 4 }}>{d.notes}</div> : null}
                      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(d.showOnPublicMenu)}
                          onChange={(e) => updateDrink(d.id, { showOnPublicMenu: e.target.checked })}
                        />
                        Exibir no cardápio público
                      </label>

                      <div style={{ marginTop: 8 }}>
                        <div style={small}>Preço no cardápio público</div>
                        <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <div style={pillStyle((d.publicMenuPriceMode ?? "markup") === "markup")} onClick={() => updateDrink(d.id, { publicMenuPriceMode: "markup" })}>
                            Markup
                          </div>
                          <div style={pillStyle(d.publicMenuPriceMode === "cmv")} onClick={() => updateDrink(d.id, { publicMenuPriceMode: "cmv" })}>
                            CMV
                          </div>
                          <div style={pillStyle(d.publicMenuPriceMode === "manual")} onClick={() => updateDrink(d.id, { publicMenuPriceMode: "manual" })}>
                            Manual
                          </div>
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <NumberField
                            style={{ ...input, width: 130 }}
                            value={d.manualPublicPrice ?? 0}
                            decimals={2}
                            min={0}
                            onCommit={(n) => updateDrink(d.id, { manualPublicPrice: n })}
                          />
                        </div>
                        <div style={{ ...small, marginTop: 6 }}>
                          Preço selecionado: {formatBRL(publicPrice)}
                        </div>
                      </div>

                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                        {prices.map((p) => (
                          <div key={p.label} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <div style={small}>{p.label}</div>
                            <div style={{ fontSize: 17, fontWeight: 650 }}>{formatBRL(p.value)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={d.id} style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 12, background: "white" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 650 }}>{d.name}</div>
                        {d.notes ? <div style={small}>{d.notes}</div> : null}
                        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(d.showOnPublicMenu)}
                            onChange={(e) => updateDrink(d.id, { showOnPublicMenu: e.target.checked })}
                          />
                          Exibir no cardápio público
                        </label>
                        <div style={{ marginTop: 8 }}>
                          <div style={small}>Preço no cardápio público</div>
                          <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <div style={pillStyle((d.publicMenuPriceMode ?? "markup") === "markup")} onClick={() => updateDrink(d.id, { publicMenuPriceMode: "markup" })}>
                              Markup
                            </div>
                            <div style={pillStyle(d.publicMenuPriceMode === "cmv")} onClick={() => updateDrink(d.id, { publicMenuPriceMode: "cmv" })}>
                              CMV
                            </div>
                            <div style={pillStyle(d.publicMenuPriceMode === "manual")} onClick={() => updateDrink(d.id, { publicMenuPriceMode: "manual" })}>
                              Manual
                            </div>
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <NumberField
                              style={{ ...input, width: 130 }}
                              value={d.manualPublicPrice ?? 0}
                              decimals={2}
                              min={0}
                              onCommit={(n) => updateDrink(d.id, { manualPublicPrice: n })}
                            />
                          </div>
                          <div style={{ ...small, marginTop: 6 }}>
                            Preço selecionado: {formatBRL(publicPrice)}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {prices.map((p) => (
                          <div key={p.label} style={{ textAlign: "right" }}>
                            <div style={small}>{p.label}</div>
                            <div style={{ fontSize: 18, fontWeight: 650 }}>{formatBRL(p.value)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              )}

              {cartaRows.length === 0 && (
                <div style={{ padding: 14, border: "1px dashed var(--border)", borderRadius: 14, color: "var(--muted)" }}>
                  Nenhum drink encontrado.
                </div>
              )}
            </div>
          </div>
        )}

        {/* -------------------- SETTINGS -------------------- */}
        {tab === "settings" && (
          <div style={card}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Configurações</h2>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <div>
                <div style={small}>Markup (x)</div>
                <NumberField
                  style={input}
                  value={settings.markup}
                  decimals={2} // preço/regra: 2 casas para valores monetários; markup pode ser fracionário
                  min={0}
                  max={100}
                  onCommit={(n) => setSettings((s) => ({ ...s, markup: n }))}
                />
              </div>

              <div>
                <div style={small}>CMV alvo (%)</div>
                <NumberField
                  style={input}
                  value={Math.round(settings.targetCmv * 100)}
                  decimals={0} // percentual inteiro
                  min={1}
                  max={100}
                  inputMode="numeric"
                  onCommit={(n) => setSettings((s) => ({ ...s, targetCmv: clamp(n, 1, 100) / 100 }))}
                />
              </div>

              <div>
                <div style={small}>1 dash = (ml)</div>
                <NumberField
                  style={input}
                  value={settings.dashMl}
                  decimals={2}
                  min={0}
                  max={10}
                  onCommit={(n) => setSettings((s) => ({ ...s, dashMl: n }))}
                />
              </div>

              <div>
                <div style={small}>1 gota = (ml)</div>
                <NumberField
                  style={input}
                  value={settings.dropMl}
                  decimals={2}
                  min={0}
                  max={1}
                  onCommit={(n) => setSettings((s) => ({ ...s, dropMl: n }))}
                />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ ...small, marginBottom: 6 }}>Exibir preço (cardápio público)</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={pillStyle(settings.publicMenuPriceVisibility === "show")} onClick={() => setSettings((s) => ({ ...s, publicMenuPriceVisibility: "show" }))}>Mostrar</div>
                <div style={pillStyle(settings.publicMenuPriceVisibility === "none")} onClick={() => setSettings((s) => ({ ...s, publicMenuPriceVisibility: "none" }))}>Ocultar</div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ ...small, marginBottom: 6 }}>Arredondamento psicológico (Receitas e preços)</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={pillStyle(settings.roundingMode === "none")} onClick={() => setSettings((s) => ({ ...s, roundingMode: "none" }))}>Nenhum</div>
                <div style={pillStyle(settings.roundingMode === "end_90")} onClick={() => setSettings((s) => ({ ...s, roundingMode: "end_90" }))}>Terminar em ,90</div>
                <div style={pillStyle(settings.roundingMode === "end_50")} onClick={() => setSettings((s) => ({ ...s, roundingMode: "end_50" }))}>Terminar em ,50</div>
                <div style={pillStyle(settings.roundingMode === "end_00")} onClick={() => setSettings((s) => ({ ...s, roundingMode: "end_00" }))}>Terminar em ,00</div>
              </div>
            </div>

            <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "14px 0" }} />

            <button
              style={btnDanger}
              onClick={() => {
                if (confirm("Apagar todos os dados salvos no navegador?")) {
                  setIngredients([]);
                  setDrinks([]);
                  setSettings({ ...DEFAULT_SETTINGS });
                  setActiveDrinkId(null);
                  setActiveIngredientId(null);
                  setTab("receitas");
                }
              }}
            >
              Resetar tudo
            </button>
          </div>
        )}

        {/* -------------------- DRINKS -------------------- */}
        {tab === "drinks" && (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ marginTop: 0, fontSize: 16, marginBottom: 10 }}>Drinks</h2>
              <div style={small}>{drinks.length} drink(s)</div>
            </div>

            {drinks.length === 0 ? (
              <div style={{ padding: 14, border: "1px dashed var(--border)", borderRadius: 14, color: "var(--muted)" }}>
                Sem drinks. Clique em “+ Drink”.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 10 }}>
                  {drinks.map((d) => (
                    <div key={d.id} style={pillStyle(d.id === activeDrinkId)} onClick={() => setActiveDrinkId(d.id)}>
                      {d.name || "Sem nome"}
                    </div>
                  ))}
                </div>

                {activeDrink && (
                  <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 12 }}>
                    <input
                      style={input}
                      value={activeDrink.name}
                      onChange={(e) => updateDrink(activeDrink.id, { name: e.target.value })}
                      placeholder="Nome do drink"
                    />

                    {/* Foto do drink */}
<div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
  <div
    style={{
      width: 140,
      height: 140,
      borderRadius: 16,
      border: "1px solid var(--border)",
      background: "white",
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--muted)",
      fontSize: 12,
    }}
  >
    {activeDrink.photoDataUrl ? (
      <img
        src={activeDrink.photoDataUrl}
        alt="Foto do drink"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    ) : (
      "Sem foto"
    )}
  </div>

  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <label style={{ ...btn, display: "inline-block", cursor: "pointer" }}>
      Inserir foto
      <input
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;

          const reader = new FileReader();
          reader.onload = () => {
            updateDrink(activeDrink.id, {
              photoDataUrl: reader.result as string,
            });
          };
          reader.readAsDataURL(f);
        }}
      />
    </label>

    <button
      style={btnDanger}
      disabled={!activeDrink.photoDataUrl}
      onClick={() => updateDrink(activeDrink.id, { photoDataUrl: undefined })}
    >
      Remover foto
    </button>
  </div>
</div>

                    {/* KPIs */}
                    {(() => {
                      const c = computedByDrinkId.get(activeDrink.id);
                      if (!c) return null;

                      const cost = c.cost;
                      const markupP = applyPsychRounding(c.priceMarkup, settings.roundingMode);
                      const cmvP = applyPsychRounding(c.priceCmv, settings.roundingMode);

                      const blocks: React.ReactNode[] = [
                        <div key="cost" style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 12, background: "white" }}>
                          <div style={small}>Custo</div>
                          <div style={{ fontSize: 18 }}>{formatBRL(cost)}</div>
                        </div>,
                        <div key="m" style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 12, background: "white" }}>
                          <div style={small}>Preço (markup {settings.markup}x) • {settings.roundingMode === "none" ? "sem arred." : "arred."}</div>
                          <div style={{ fontSize: 18 }}>{formatBRL(markupP)}</div>
                        </div>,
                        <div key="c" style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 12, background: "white" }}>
                          <div style={small}>Preço (CMV {Math.round(settings.targetCmv * 100)}%) • {settings.roundingMode === "none" ? "sem arred." : "arred."}</div>
                          <div style={{ fontSize: 18 }}>{formatBRL(cmvP)}</div>
                        </div>,
                      ];

                      return (
                        <div style={{ display: "grid", gridTemplateColumns: `repeat(${blocks.length}, minmax(0, 1fr))`, gap: 10, marginTop: 10 }}>
                          {blocks}
                        </div>
                      );
                    })()}

                    <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "12px 0" }} />

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 14 }}>Receita</strong>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button style={btn} onClick={() => addItemToDrink(activeDrink.id)} disabled={!ingredients.length}>+ Item</button>
                        <button style={btn} onClick={() => duplicateDrink(activeDrink.id)}>Duplicar drink</button>
                        <button style={btnDanger} onClick={() => removeDrink(activeDrink.id)}>Remover drink</button>
                      </div>
                    </div>

                    {activeDrink.items.length === 0 ? (
                      <div style={{ marginTop: 10, padding: 14, border: "1px dashed var(--border)", borderRadius: 14, color: "var(--muted)" }}>
                        Sem itens. Clique em “+ Item”.
                      </div>
                    ) : (
                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                        {activeDrink.items.map((it, idx) => {
                          const ing = ingredientMap.get(it.ingredientId);
                          const cpm = ing ? computeCostPerMl(ing) : null;
                          const perUnit = ing?.pricingModel === "by_unit" ? (ing.costPerUnit ?? 0) : 0;
                          const hint = it.unit === "un" ? `${formatBRL(perUnit)} / un` : `${formatBRL(cpm ?? 0)} / ml`;

                          return (
                            <div key={`${activeDrink.id}_${idx}`} style={{ display: "grid", gridTemplateColumns: "2fr 0.8fr 0.9fr 1fr 0.8fr", gap: 8, alignItems: "center" }}>
                              <select style={input} value={it.ingredientId} onChange={(e) => updateItem(activeDrink.id, idx, { ingredientId: e.target.value })}>
                                {ingredients.map((i) => (
                                  <option key={i.id} value={i.id}>{i.name}</option>
                                ))}
                              </select>

                              <NumberField
                                style={input}
                                value={it.qty}
                                decimals={it.unit === "ml" ? 0 : 2} // ml inteiro; dash/gota podem ser fracionários em quantidade
                                min={0}
                                onCommit={(n) => updateItem(activeDrink.id, idx, { qty: n })}
                              />

                              <select style={input} value={it.unit} onChange={(e) => updateItem(activeDrink.id, idx, { unit: e.target.value as RecipeUnit })}>
                                <option value="ml">ml</option>
                                <option value="dash">dash</option>
                                <option value="drop">gota</option>
                                <option value="un">un</option>
                              </select>

                              <div style={small}>{hint}</div>

                              <button style={btnDanger} onClick={() => removeItem(activeDrink.id, idx)}>Remover</button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div style={{ marginTop: 10 }}>
                      <textarea
                        style={{ ...input, minHeight: 70 }}
                        value={activeDrink.notes ?? ""}
                        placeholder="Notas (opcional)"
                        onChange={(e) => updateDrink(activeDrink.id, { notes: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* -------------------- INGREDIENTS -------------------- */}
        {tab === "ingredients" && (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ marginTop: 0, fontSize: 16, marginBottom: 10 }}>Ingredientes</h2>
              <div style={small}>{ingredients.length} ingrediente(s)</div>
            </div>

            {ingredients.length === 0 ? (
              <div style={{ padding: 14, border: "1px dashed var(--border)", borderRadius: 14, color: "var(--muted)" }}>
                Sem ingredientes. Clique em “+ Ingrediente”.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 10 }}>
                  {ingredients.map((i) => (
                    <div key={i.id} style={pillStyle(i.id === activeIngredientId)} onClick={() => setActiveIngredientId(i.id)}>
                      {i.name || "Sem nome"}
                    </div>
                  ))}
                </div>

                {activeIngredient && (
                  <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                      <input
                        style={input}
                        value={activeIngredient.name}
                        onChange={(e) => updateIngredient(activeIngredient.id, { name: e.target.value })}
                        placeholder="Nome do ingrediente"
                      />

                      <select
                        style={input}
                        value={activeIngredient.pricingModel}
                        onChange={(e) => updateIngredient(activeIngredient.id, { pricingModel: e.target.value as PricingModel })}
                      >
                        <option value="by_bottle">Por garrafa (R$ + ml + yield)</option>
                        <option value="by_ml">Direto R$/ml</option>
                        <option value="by_unit">Por unidade</option>
                      </select>
                    </div>

                    {activeIngredient.pricingModel === "by_bottle" && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 10 }}>
                        <div>
                          <div style={small}>Preço (R$)</div>
                          <NumberField
                            style={input}
                            value={activeIngredient.bottlePrice ?? 0}
                            decimals={2}
                            min={0}
                            onCommit={(n) => updateIngredient(activeIngredient.id, { bottlePrice: n })}
                          />
                        </div>

                        <div>
                          <div style={small}>ml nominal</div>
                          <NumberField
                            style={input}
                            value={activeIngredient.bottleMl ?? 0}
                            decimals={0}
                            min={0}
                            inputMode="numeric"
                            onCommit={(n) => updateIngredient(activeIngredient.id, { bottleMl: n })}
                          />
                        </div>

                        <div>
                          <div style={small}>yield real (ml)</div>
                          <NumberField
                            style={input}
                            value={activeIngredient.yieldMl ?? (activeIngredient.bottleMl ?? 0)}
                            decimals={0}
                            min={0}
                            inputMode="numeric"
                            onCommit={(n) => updateIngredient(activeIngredient.id, { yieldMl: n })}
                          />
                        </div>

                        <div>
                          <div style={small}>perdas (%)</div>
                          <NumberField
                            style={input}
                            value={activeIngredient.lossPct ?? 0}
                            decimals={0}
                            min={0}
                            max={100}
                            inputMode="numeric"
                            onCommit={(n) => updateIngredient(activeIngredient.id, { lossPct: n })}
                          />
                        </div>

                        <div style={{ gridColumn: "1 / -1", background: "white", border: "1px solid var(--border)", borderRadius: 14, padding: 12 }}>
                          <div style={small}>R$/ml calculado</div>
                          <div style={{ fontSize: 16 }}>{formatBRL(computeCostPerMl(activeIngredient) ?? 0)} / ml</div>
                        </div>
                      </div>
                    )}

                    {activeIngredient.pricingModel === "by_ml" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                        <div>
                          <div style={small}>R$/ml</div>
                          <NumberField
                            style={input}
                            value={activeIngredient.costPerMl ?? 0}
                            decimals={2}
                            min={0}
                            onCommit={(n) => updateIngredient(activeIngredient.id, { costPerMl: n })}
                          />
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-end" }}>
                          <div style={{ fontSize: 16 }}>{formatBRL(computeCostPerMl(activeIngredient) ?? 0)} / ml</div>
                        </div>
                      </div>
                    )}

                    {activeIngredient.pricingModel === "by_unit" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                        <div>
                          <div style={small}>R$ por unidade</div>
                          <NumberField
                            style={input}
                            value={activeIngredient.costPerUnit ?? 0}
                            decimals={2}
                            min={0}
                            onCommit={(n) => updateIngredient(activeIngredient.id, { costPerUnit: n })}
                          />
                        </div>
                      </div>
                    )}

                    <div style={{ marginTop: 10 }}>
                      <textarea
                        style={{ ...input, minHeight: 70 }}
                        value={activeIngredient.notes ?? ""}
                        placeholder="Notas (opcional)"
                        onChange={(e) => updateIngredient(activeIngredient.id, { notes: e.target.value })}
                      />
                    </div>

                    <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                      <button style={btn} onClick={() => duplicateIngredient(activeIngredient.id)}>Duplicar ingrediente</button>
                      <button style={btnDanger} onClick={() => removeIngredient(activeIngredient.id)}>Remover ingrediente</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
