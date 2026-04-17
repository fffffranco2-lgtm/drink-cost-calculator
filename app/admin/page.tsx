"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { type AdminOrder, type AdminOrderItem, type OrderSource, type OrderStatus } from "@/lib/orders";
import { clamp, formatBRL, makeCopyName } from "@/lib/utils";
import { NumberField } from "@/app/admin/components/NumberField";
import { ScrollShadow } from "@/app/admin/components/ScrollShadow";
import { useQzConnection } from "@/app/admin/hooks/useQzConnection";
import { ResumoTab } from "@/app/admin/components/ResumoTab";
import { DrinksTab } from "@/app/admin/components/DrinksTab";
import { IngredientsTab } from "@/app/admin/components/IngredientsTab";
import { SettingsTab } from "@/app/admin/components/SettingsTab";
import {
  type RecipeUnit,
  type PricingModel,
  type IngredientCategory,
  type PublicMenuDrinkPriceMode,
  type PublicMenuPriceVisibility,
  type CartaViewMode,
  type RecipeSortMode,
  type RoundingMode,
  type Ingredient,
  type RecipeItem,
  type Drink,
  type Settings,
  type AppStatePayload,
  type ExportPayload,
  INGREDIENT_CATEGORIES,
  INGREDIENT_CATEGORY_LABEL,
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  REMOTE_SAVE_DEBOUNCE_MS,
  LOCAL_SAVE_DEBOUNCE_MS,
  uid,
  applyPsychRounding,
  computeCostPerMl,
  computeItemCost,
  computeDrinkCost,
  normalizeIngredient,
  normalizeIngredients,
  normalizeDrink,
  normalizeSettings,
  formatRecipeItemsForDisplay,
  FONT_SCALE,
  pillStyle,
  compactPillStyle,
  adminCard,
  adminHeaderCard,
  adminBtn,
  adminBtnDanger,
  adminIconBtn,
  adminIconBtnDanger,
  adminInput,
  adminSmall,
  adminTopTab,
  adminCategoryButtonStyle,
  adminIngredientButtonStyle,
} from "@/app/admin/admin-types";



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

function exportAsCsv(payload: ExportPayload) {
  const ingredientsRows = payload.ingredients.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
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
      showPublicMenuGarnish: payload.settings.showPublicMenuGarnish,
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
    out.ingredients = normalizeIngredients(parsed.data);
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
        showPublicMenuGarnish: r.showPublicMenuGarnish,
        publicMenuPriceMode: r.publicMenuPriceMode,
        roundingMode: (r.roundingMode as RoundingMode) || "none",
      });
    }
  }

  return out;
}

export default function Page() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const lastRemoteStateRef = useRef<string>("");
  const lastLocalStateRef = useRef<string>("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [hydratingRemote, setHydratingRemote] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [remoteError, setRemoteError] = useState<string>("");

  const [tab, setTab] = useState<"receitas" | "drinks" | "ingredients" | "settings">("receitas");
  const [activeDrinkId, setActiveDrinkId] = useState<string | null>(null);
  const [activeIngredientId, setActiveIngredientId] = useState<string | null>(null);
  const [ingredientCategoryTab, setIngredientCategoryTab] = useState<IngredientCategory>(INGREDIENT_CATEGORIES[0]);

  const [menuSearch, setMenuSearch] = useState("");
  const [cartaViewMode, setCartaViewMode] = useState<CartaViewMode>("cards");
  const [recipeSortMode, setRecipeSortMode] = useState<RecipeSortMode>("alpha_asc");
  const [settingsTab, setSettingsTab] = useState<"geral" | "impressao">("geral");
  const routePrintTabAppliedRef = useRef(false);
  const {
    qzConnectionState,
    qzPrinterName,
    setQzPrinterName,
    qzBusy,
    qzError,
    connectQz,
    printStyledTestViaQz,
  } = useQzConnection();

  const remoteState: AppStatePayload = useMemo(
    () => ({
      ingredients,
      drinks,
      settings,
      activeDrinkId,
      activeIngredientId,
      tab,
      cartaViewMode,
    }),
    [ingredients, drinks, settings, activeDrinkId, activeIngredientId, tab, cartaViewMode]
  );
  const remoteStateJson = useMemo(() => JSON.stringify(remoteState), [remoteState]);

  const localStateJson = useMemo(
    () =>
      JSON.stringify({
        ingredients,
        drinks,
        settings,
      }),
    [ingredients, drinks, settings]
  );

  useEffect(() => {
    let active = true;

    (async () => {
      if (!supabase) {
        setRemoteError("Variáveis do Supabase não configuradas no ambiente.");
        setHydratingRemote(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) return;
      if (!user) {
        window.location.href = "/admin/login";
        return;
      }

      setAuthed(true);

      const { data, error } = await supabase.from("app_state").select("state").eq("user_id", "shared").maybeSingle();
      if (!active) return;

      if (error) {
        setRemoteError("Falha ao carregar dados do Supabase.");
        setHydratingRemote(false);
        return;
      }

      const state = data?.state as Partial<AppStatePayload> | undefined;
      if (state) {
        const normalizedIngredients = normalizeIngredients(state.ingredients);
        if (state.ingredients) setIngredients(normalizedIngredients);
        if (state.drinks) setDrinks((state.drinks as any[]).map((d) => normalizeDrink(d)));
        if (state.settings) setSettings(normalizeSettings(state.settings));
        if (state.activeDrinkId) setActiveDrinkId(state.activeDrinkId);
        if (state.activeIngredientId) setActiveIngredientId(state.activeIngredientId);
        if (state.tab) setTab(state.tab === "carta" || state.tab === "orders" ? "receitas" : state.tab);
        if (state.cartaViewMode === "cards" || state.cartaViewMode === "list") {
          setCartaViewMode(state.cartaViewMode);
        }
        lastRemoteStateRef.current = JSON.stringify({
          ingredients: normalizedIngredients,
          drinks: state.drinks ?? [],
          settings: state.settings ?? DEFAULT_SETTINGS,
          activeDrinkId: state.activeDrinkId ?? null,
          activeIngredientId: state.activeIngredientId ?? null,
          tab: state.tab === "carta" || state.tab === "orders" ? "receitas" : state.tab ?? "receitas",
          cartaViewMode: state.cartaViewMode === "list" ? "list" : "cards",
        });
      }

      setHydratingRemote(false);
    })();

    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (hydratingRemote || routePrintTabAppliedRef.current) return;
    routePrintTabAppliedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    const settingsTabParam = params.get("settingsTab");
    if (tabParam === "settings" || settingsTabParam === "impressao") {
      setTab("settings");
    }
    if (settingsTabParam === "impressao") {
      setSettingsTab("impressao");
    }
  }, [hydratingRemote]);

  useEffect(() => {
    if (hydratingRemote || !authed || !supabase) return;
    if (lastRemoteStateRef.current === remoteStateJson) return;

    const timeout = setTimeout(async () => {
      const { error } = await supabase
        .from("app_state")
        .upsert({ user_id: "shared", state: remoteState, updated_at: new Date().toISOString() });

      if (error) {
        setRemoteError("Falha ao salvar alterações no Supabase.");
      } else {
        lastRemoteStateRef.current = remoteStateJson;
      }
    }, REMOTE_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [
    hydratingRemote,
    authed,
    remoteState,
    remoteStateJson,
    supabase,
  ]);

  useEffect(() => {
    if (hydratingRemote) return;
    if (lastLocalStateRef.current === localStateJson) return;

    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, localStateJson);
        lastLocalStateRef.current = localStateJson;
      } catch {
        // ignora erro de quota/storage indisponível
      }
    }, LOCAL_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [hydratingRemote, localStateJson]);

  // seed: 3 drinks
  useEffect(() => {
    if (hydratingRemote || ingredients.length || drinks.length) return;

    const gin: Ingredient = { id: uid("ing"), name: "Gin (750ml)", category: "destilados_base", pricingModel: "by_bottle", bottlePrice: 120, bottleMl: 750, yieldMl: 720, lossPct: 0 };
    const vodka: Ingredient = { id: uid("ing"), name: "Vodka (750ml)", category: "destilados_base", pricingModel: "by_bottle", bottlePrice: 95, bottleMl: 750, yieldMl: 720, lossPct: 0 };
    const campari: Ingredient = { id: uid("ing"), name: "Campari (750ml)", category: "amaros_aperitivos", pricingModel: "by_bottle", bottlePrice: 110, bottleMl: 750, yieldMl: 720, lossPct: 0 };
    const vermuteRosso: Ingredient = { id: uid("ing"), name: "Vermute Rosso (1L)", category: "fortificados", pricingModel: "by_bottle", bottlePrice: 80, bottleMl: 1000, yieldMl: 950, lossPct: 0 };
    const lillet: Ingredient = { id: uid("ing"), name: "Lillet Blanc (750ml)", category: "fortificados", pricingModel: "by_bottle", bottlePrice: 140, bottleMl: 750, yieldMl: 720, lossPct: 0 };
    const angostura: Ingredient = { id: uid("ing"), name: "Angostura (bitters)", category: "bitters", pricingModel: "by_bottle", bottlePrice: 70, bottleMl: 200, yieldMl: 190, lossPct: 0 };
    const orangePeel: Ingredient = { id: uid("ing"), name: "Casca de laranja (garnish)", category: "garnish", pricingModel: "by_unit", costPerUnit: 0.4 };
    const lemonPeel: Ingredient = { id: uid("ing"), name: "Casca de limão (garnish)", category: "garnish", pricingModel: "by_unit", costPerUnit: 0.35 };

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

  const ingredientGroups = useMemo(
    () =>
      INGREDIENT_CATEGORIES.map((category) => ({
        category,
        items: ingredients.filter((i) => i.category === category),
      })).filter((group) => group.items.length > 0),
    [ingredients]
  );

  const activeCategoryIngredients = useMemo(
    () => ingredients.filter((i) => i.category === ingredientCategoryTab),
    [ingredients, ingredientCategoryTab]
  );

  useEffect(() => {
    if (!ingredients.length) return;
    if (activeIngredientId && ingredients.some((i) => i.id === activeIngredientId && i.category === ingredientCategoryTab)) return;
    const firstInCategory = ingredients.find((i) => i.category === ingredientCategoryTab);
    if (firstInCategory) setActiveIngredientId(firstInCategory.id);
  }, [ingredients, activeIngredientId, ingredientCategoryTab]);

  // CRUD
  const addIngredient = () => {
    const ing: Ingredient = {
      id: uid("ing"),
      name: "Novo ingrediente",
      category: ingredientCategoryTab,
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
    if (!supabase) {
      window.location.href = "/";
      return;
    }
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const triggerCsvImport = () => {
    csvInputRef.current?.click();
  };

  const importFromCsvFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const data = parseCombinedCsv(text);
        const normalizedIngredients = normalizeIngredients(data.ingredients);

        if (data.ingredients) setIngredients(normalizedIngredients);
        if (data.drinks) setDrinks(data.drinks);
        if (data.settings) setSettings(data.settings);

        if (data.ingredients) setActiveIngredientId(normalizedIngredients[0]?.id ?? null);
        if (data.drinks) setActiveDrinkId(data.drinks[0]?.id ?? null);
      } catch {
        alert("Falha ao importar CSV. Verifique o formato do arquivo.");
      }
    };
    reader.readAsText(file, "utf-8");
  };

  /* ------------------------------ Theme ------------------------------ */

  const themeVars: React.CSSProperties = {
    ["--bg" as any]: "#f6f2ea",
    ["--panel" as any]: "#fffdf9",
    ["--panel2" as any]: "#fff4e7",
    ["--pill" as any]: "#f7ebdb",
    ["--pillActive" as any]: "#eaf6f4",
    ["--ink" as any]: "#1d232a",
    ["--muted" as any]: "#5a6672",
    ["--border" as any]: "#dccdb8",
    ["--shadow" as any]: "0 12px 30px rgba(32, 37, 42, 0.08)",
    ["--btn" as any]: "#f3e8d8",
    ["--danger" as any]: "#fff0f0",
    ["--dangerBorder" as any]: "#f2caca",
    ["--focus" as any]: "rgba(15, 118, 110, 0.28)",
  };

  const page: React.CSSProperties = {
    ...themeVars,
    backgroundColor: "var(--bg)",
    minHeight: "100vh",
    color: "var(--ink)",
    padding: 24,
    fontFamily: 'var(--font-app-sans), "Trebuchet MS", "Segoe UI", sans-serif',
  };

  // aliases locais para os estilos exportados (evita renomear cada uso no JSX)
  const container: React.CSSProperties = { maxWidth: 1160, margin: "0 auto" };
  const card = adminCard;
  const headerCard = adminHeaderCard;
  const btn = adminBtn;
  const btnDanger = adminBtnDanger;
  const iconBtn = adminIconBtn;
  const iconBtnDanger = adminIconBtnDanger;
  const input = adminInput;
  const small = adminSmall;
  const topTab = adminTopTab;
  const categoryButtonStyle = adminCategoryButtonStyle;
  const ingredientButtonStyle = adminIngredientButtonStyle;

  const focusStyle = `
    input:focus, textarea:focus, select:focus {
      box-shadow: 0 0 0 4px var(--focus);
      border-color: #76b6ae;
    }
    @media (max-width: 900px) {
      .settings-grid,
      .ingredient-main-grid,
      .ingredient-bottle-grid,
      .ingredient-two-grid {
        grid-template-columns: 1fr !important;
      }
      .recipe-list-grid {
        grid-template-columns: 1fr !important;
      }
      .kpi-grid {
        grid-template-columns: 1fr !important;
      }
      .recipe-item-row {
        grid-template-columns: 1fr !important;
      }
    }
  `;

  /* ------------------------------ Views ------------------------------ */

  function getFinalPriceForDrink(dId: string): { label: string; value: number }[] {
    const c = computedByDrinkId.get(dId);
    if (!c) return [];
    return [
      { label: "Custo", value: c.cost },
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
    const rows = [...drinks].map((d) => {
        const nameWidthCh = Math.max(10, Math.min(22, d.name.trim().length + 2));
        const ingredientLines = formatRecipeItemsForDisplay(d.items, ingredientMap);

        return {
          d,
          cost: computedByDrinkId.get(d.id)?.cost ?? 0,
          prices: getFinalPriceForDrink(d.id),
          publicPrice: getPublicMenuPriceForDrink(d),
          ingredientLines,
          nameWidthCh,
        };
      });

    rows.sort((a, b) => {
      if (recipeSortMode === "alpha_asc") return a.d.name.localeCompare(b.d.name, "pt-BR");
      if (recipeSortMode === "alpha_desc") return b.d.name.localeCompare(a.d.name, "pt-BR");
      if (recipeSortMode === "price_asc") {
        if (a.publicPrice !== b.publicPrice) return a.publicPrice - b.publicPrice;
        return a.d.name.localeCompare(b.d.name, "pt-BR");
      }
      if (recipeSortMode === "cost_asc") {
        if (a.cost !== b.cost) return a.cost - b.cost;
        return a.d.name.localeCompare(b.d.name, "pt-BR");
      }
      if (recipeSortMode === "cost_desc") {
        if (a.cost !== b.cost) return b.cost - a.cost;
        return a.d.name.localeCompare(b.d.name, "pt-BR");
      }
      if (a.publicPrice !== b.publicPrice) return b.publicPrice - a.publicPrice;
      return a.d.name.localeCompare(b.d.name, "pt-BR");
    });

    return rows.filter(({ d, ingredientLines }) =>
      q ? d.name.toLowerCase().includes(q) || ingredientLines.some((line) => line.toLowerCase().includes(q)) : true
    );
  }, [drinks, menuSearch, computedByDrinkId, ingredientMap, settings.roundingMode, settings.markup, settings.targetCmv, recipeSortMode]);

  useEffect(() => {
    if (hydratingRemote || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    const settingsTabParam = params.get("settingsTab");

    if (tabParam !== "settings") return;
    setTab("settings");
    if (settingsTabParam === "impressao" || settingsTabParam === "geral") {
      setSettingsTab(settingsTabParam);
    }
  }, [hydratingRemote]);

  return (
    <div style={page}>
      <style>{focusStyle}</style>

      <div style={container}>
        <div style={{ ...headerCard, marginBottom: 14, padding: "12px 16px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button style={topTab(tab === "receitas")} onClick={() => setTab("receitas")}>Resumo</button>
            <button style={topTab(tab === "drinks")} onClick={() => setTab("drinks")}>Drinks</button>
            <button style={topTab(tab === "ingredients")} onClick={() => setTab("ingredients")}>Ingredientes</button>

            {remoteError && <div style={{ ...small, color: "#b00020", marginLeft: 8 }}>{remoteError}</div>}

            <div style={{ flex: 1 }} />

            <button
              style={{ ...topTab(tab === "settings"), display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              onClick={() => setTab("settings")}
              title="Configurações"
              aria-label="Configurações"
            >
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>settings</span>
            </button>
          </div>
        </div>

        {/* -------------------- RECEITAS -------------------- */}
        {tab === "receitas" && (
          <ResumoTab
            settings={settings}
            cartaViewMode={cartaViewMode}
            setCartaViewMode={setCartaViewMode}
            menuSearch={menuSearch}
            setMenuSearch={setMenuSearch}
            recipeSortMode={recipeSortMode}
            setRecipeSortMode={setRecipeSortMode}
            cartaRows={cartaRows}
            updateDrink={updateDrink}
          />
        )}


        {/* -------------------- SETTINGS -------------------- */}
        {tab === "settings" && (
          <SettingsTab
            settings={settings}
            setSettings={setSettings}
            settingsTab={settingsTab}
            setSettingsTab={setSettingsTab}
            ingredients={ingredients}
            drinks={drinks}
            setIngredients={setIngredients}
            setDrinks={setDrinks}
            setActiveDrinkId={setActiveDrinkId}
            setActiveIngredientId={setActiveIngredientId}
            setTab={setTab}
            csvInputRef={csvInputRef}
            onExportCsv={() => exportAsCsv({ ingredients, drinks, settings })}
            onTriggerCsvImport={triggerCsvImport}
            onImportCsvFile={importFromCsvFile}
            qzConnectionState={qzConnectionState}
            qzPrinterName={qzPrinterName}
            setQzPrinterName={setQzPrinterName}
            qzBusy={qzBusy}
            qzError={qzError}
            onConnectQz={connectQz}
            onPrintTest={printStyledTestViaQz}
          />
        )}

        {/* -------------------- DRINKS -------------------- */}
        {tab === "drinks" && (
          <DrinksTab
            drinks={drinks}
            ingredients={ingredients}
            activeDrinkId={activeDrinkId}
            activeDrink={activeDrink}
            setActiveDrinkId={setActiveDrinkId}
            computedByDrinkId={computedByDrinkId}
            ingredientMap={ingredientMap}
            ingredientGroups={ingredientGroups}
            settings={settings}
            onAddDrink={addDrink}
            onUpdateDrink={updateDrink}
            onRemoveDrink={removeDrink}
            onDuplicateDrink={duplicateDrink}
            onAddItemToDrink={addItemToDrink}
            onUpdateItem={updateItem}
            onRemoveItem={removeItem}
            onUploadPhoto={async (drinkId, file) => {
              try {
                const photoDataUrl = await fileToDataUrlResized(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.82 });
                updateDrink(drinkId, { photoDataUrl });
              } catch {
                const reader = new FileReader();
                reader.onload = () => { updateDrink(drinkId, { photoDataUrl: reader.result as string }); };
                reader.readAsDataURL(file);
              }
            }}
          />
        )}

        {/* -------------------- INGREDIENTS -------------------- */}
        {tab === "ingredients" && (
          <IngredientsTab
            ingredients={ingredients}
            activeIngredientId={activeIngredientId}
            activeIngredient={activeIngredient}
            activeCategoryIngredients={activeCategoryIngredients}
            ingredientCategoryTab={ingredientCategoryTab}
            setIngredientCategoryTab={setIngredientCategoryTab}
            setActiveIngredientId={setActiveIngredientId}
            onAddIngredient={addIngredient}
            onUpdateIngredient={updateIngredient}
            onDuplicateIngredient={duplicateIngredient}
            onRemoveIngredient={removeIngredient}
          />
        )}
      </div>
    </div>
  );
}
