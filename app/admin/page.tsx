"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useQzConnection } from "@/app/admin/hooks/useQzConnection";
import { ResumoTab } from "@/app/admin/components/ResumoTab";
import { DrinksTab } from "@/app/admin/components/DrinksTab";
import { IngredientsTab } from "@/app/admin/components/IngredientsTab";
import { SettingsTab } from "@/app/admin/components/SettingsTab";
import { exportAsCsv, parseCombinedCsv } from "@/lib/admin-csv";
import { buildInitialSeed } from "@/lib/admin-seed";
import {
  AppStateConflictError,
  loadAppState,
  saveAppState,
  type AppStateRecord,
} from "@/lib/app-state-repo";
import {
  internalPageStyle,
  internalSmallTextStyle,
} from "@/app/admin/internal-theme";
import {
  type IngredientCategory,
  type CartaViewMode,
  type RecipeSortMode,
  type DrinksPanelMode,
  type Ingredient,
  type RecipeItem,
  type Drink,
  type Settings,
  type AppStatePayload,
  INGREDIENT_CATEGORIES,
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  REMOTE_SAVE_DEBOUNCE_MS,
  LOCAL_SAVE_DEBOUNCE_MS,
  uid,
  applyPsychRounding,
  computeDrinkCost,
  normalizeDrink,
  normalizeIngredients,
  normalizeSettings,
  formatRecipeItemsForDisplay,
} from "@/app/admin/admin-types";
import { makeCopyName } from "@/lib/utils";

/** Compressão das imagens de drink. */
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
  return canvas.toDataURL("image/jpeg", quality);
}

export default function Page() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  /** O updated_at que recebemos na última leitura bem-sucedida do servidor.
   *  É o token usado no optimistic concurrency check. */
  const lastServerUpdatedAtRef = useRef<string | null>(null);
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

  const [menuSearch, setMenuSearch] = useState("");
  const [cartaViewMode, setCartaViewMode] = useState<CartaViewMode>("cards");
  const [drinksMode, setDrinksMode] = useState<DrinksPanelMode>("editor");
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
      drinksMode,
    }),
    [ingredients, drinks, settings, activeDrinkId, activeIngredientId, tab, cartaViewMode, drinksMode]
  );
  const remoteStateJson = useMemo(() => JSON.stringify(remoteState), [remoteState]);

  const localStateJson = useMemo(
    () => JSON.stringify({ ingredients, drinks, settings }),
    [ingredients, drinks, settings]
  );

  /** Aplica um AppStateRecord completo ao state local. Usado tanto na
   *  hidratação inicial quanto na reconciliação após conflito. */
  const applyServerRecord = useCallback((record: AppStateRecord) => {
    const state = record.state ?? {};
    const normalizedIngredients = normalizeIngredients(state.ingredients);
    setIngredients(normalizedIngredients);
    setDrinks((state.drinks ?? []).map((d) => normalizeDrink(d)));
    setSettings(normalizeSettings(state.settings ?? DEFAULT_SETTINGS));
    if (state.activeDrinkId) setActiveDrinkId(state.activeDrinkId);
    if (state.activeIngredientId) setActiveIngredientId(state.activeIngredientId);
    if (state.tab) {
      setTab(state.tab === "carta" || state.tab === "orders" ? "receitas" : state.tab);
    }
    if (state.cartaViewMode === "cards" || state.cartaViewMode === "list") {
      setCartaViewMode(state.cartaViewMode);
    }
    if (state.drinksMode === "editor" || state.drinksMode === "pricing") {
      setDrinksMode(state.drinksMode);
    }
    lastServerUpdatedAtRef.current = record.updatedAt;
    lastRemoteStateRef.current = JSON.stringify(record.state ?? {});
  }, []);

  /* ---------------------- hidratação inicial ---------------------- */
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

      try {
        const record = await loadAppState(supabase);
        if (!active) return;
        if (record) {
          applyServerRecord(record);
        } else {
          // Primeira vez: cria com seed apenas se realmente não há nada no servidor.
          const seed = buildInitialSeed();
          setIngredients(seed.ingredients);
          setDrinks(seed.drinks);
          setActiveDrinkId(seed.drinks[0]?.id ?? null);
          setActiveIngredientId(seed.ingredients[0]?.id ?? null);
          // lastServerUpdatedAtRef fica null — o próximo save fará INSERT.
          lastServerUpdatedAtRef.current = null;
          lastRemoteStateRef.current = "";
        }
      } catch {
        if (!active) return;
        setRemoteError("Falha ao carregar dados do Supabase.");
      }

      setHydratingRemote(false);
    })();

    return () => {
      active = false;
    };
  }, [supabase, applyServerRecord]);

  /* ---------------------- roteamento de tab ---------------------- */
  useEffect(() => {
    if (hydratingRemote || routePrintTabAppliedRef.current) return;
    routePrintTabAppliedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    const settingsTabParam = params.get("settingsTab");
    if (tabParam === "settings" || settingsTabParam === "impressao") setTab("settings");
    if (settingsTabParam === "impressao") setSettingsTab("impressao");
  }, [hydratingRemote]);

  /* ---------------------- save remoto com CAS ---------------------- */
  useEffect(() => {
    if (hydratingRemote || !authed || !supabase) return;
    if (lastRemoteStateRef.current === remoteStateJson) return;

    const timeout = setTimeout(async () => {
      try {
        const record = await saveAppState(
          supabase,
          remoteState,
          lastServerUpdatedAtRef.current
        );
        lastServerUpdatedAtRef.current = record.updatedAt;
        lastRemoteStateRef.current = remoteStateJson;
        setRemoteError("");
      } catch (error) {
        if (error instanceof AppStateConflictError) {
          if (error.serverRecord) {
            applyServerRecord(error.serverRecord);
            setRemoteError(
              "Outro admin salvou antes. Recarregamos os dados mais recentes — revise suas alterações."
            );
          } else {
            setRemoteError("Conflito de edição: recarregue a página.");
          }
        } else {
          setRemoteError("Falha ao salvar alterações no Supabase.");
        }
      }
    }, REMOTE_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [hydratingRemote, authed, remoteState, remoteStateJson, supabase, applyServerRecord]);

  /* ---------------------- save local ---------------------- */
  useEffect(() => {
    if (hydratingRemote) return;
    if (lastLocalStateRef.current === localStateJson) return;

    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, localStateJson);
        lastLocalStateRef.current = localStateJson;
      } catch {
        // ignora quota/storage indisponível
      }
    }, LOCAL_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [hydratingRemote, localStateJson]);

  /* ---------------------- manter seleções válidas ---------------------- */
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

  const ingredientMap = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i])),
    [ingredients]
  );

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
    () =>
      activeIngredientId
        ? ingredients.find((i) => i.id === activeIngredientId) ?? null
        : null,
    [ingredients, activeIngredientId]
  );

  const ingredientGroups = useMemo(
    () =>
      INGREDIENT_CATEGORIES.map((category) => ({
        category,
        items: ingredients.filter((i) => i.category === category),
      })).filter((g) => g.items.length > 0),
    [ingredients]
  );


  /* ---------------------- CRUD ---------------------- */
  const addIngredient = (category?: IngredientCategory) => {
    const ing: Ingredient = {
      id: uid("ing"),
      name: "Novo ingrediente",
      category: category ?? INGREDIENT_CATEGORIES[0],
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
    setDrinks((p) =>
      p.map((d) => ({ ...d, items: d.items.filter((it) => it.ingredientId !== id) }))
    );
  };

  const duplicateIngredient = (ingredientId: string) => {
    const original = ingredients.find((i) => i.id === ingredientId);
    if (!original) return;
    const duplicateName = makeCopyName(original.name, ingredients.map((i) => i.name));
    const duplicated: Ingredient = { ...original, id: uid("ing"), name: duplicateName };
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
    const duplicateName = makeCopyName(original.name, drinks.map((d) => d.name));
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
      p.map((d) =>
        d.id === drinkId
          ? { ...d, items: [...d.items, { ingredientId: first.id, qty: 0, unit: "ml" }] }
          : d
      )
    );
  };

  const updateItem = (drinkId: string, idx: number, patch: Partial<RecipeItem>) => {
    setDrinks((p) =>
      p.map((d) =>
        d.id !== drinkId
          ? d
          : { ...d, items: d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }
      )
    );
  };

  const removeItem = (drinkId: string, idx: number) => {
    setDrinks((p) =>
      p.map((d) =>
        d.id !== drinkId ? d : { ...d, items: d.items.filter((_, i) => i !== idx) }
      )
    );
  };

  const triggerCsvImport = () => csvInputRef.current?.click();

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

  /* ---------------------- derivados ---------------------- */
  function getFinalPriceForDrink(dId: string) {
    const c = computedByDrinkId.get(dId);
    if (!c) return [] as { label: string; value: number }[];
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
    if (d.publicMenuPriceMode === "cmv")
      return applyPsychRounding(c.priceCmv, settings.roundingMode);
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
      q
        ? d.name.toLowerCase().includes(q) ||
          ingredientLines.some((line) => line.toLowerCase().includes(q))
        : true
    );
  }, [
    drinks,
    menuSearch,
    computedByDrinkId,
    ingredientMap,
    settings.roundingMode,
    settings.markup,
    settings.targetCmv,
    recipeSortMode,
  ]);

  /* ---------------------- render ---------------------- */

  return (
    <div style={{ ...internalPageStyle, padding: 0 }}>
      {/* Subtabs */}
      <div
        style={{
          display: "flex",
          gap: 2,
          alignItems: "center",
          paddingLeft: 24,
          paddingRight: 24,
          background: "var(--surface)",
          borderBottom: "1px solid var(--line)",
        }}
      >
          {(
            [
              { key: "receitas", label: "Resumo" },
              { key: "drinks", label: "Drinks" },
              { key: "ingredients", label: "Ingredientes" },
            ] as const
          ).map(({ key, label }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  padding: "11px 12px",
                  border: "none",
                  background: "transparent",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--accent-strong)" : "var(--muted)",
                  cursor: "pointer",
                  borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                  marginBottom: -1,
                }}
              >
                {label}
              </button>
            );
          })}

          {remoteError && (
            <div style={{ ...internalSmallTextStyle, color: "#b00020", marginLeft: 8 }}>
              {remoteError}
            </div>
          )}

          <div style={{ flex: 1 }} />

          <button
            onClick={() => setTab("settings")}
            title="Configurações"
            aria-label="Configurações"
            style={{
              padding: "11px 12px",
              border: "none",
              background: "transparent",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: tab === "settings" ? 600 : 500,
              color: tab === "settings" ? "var(--accent-strong)" : "var(--muted)",
              cursor: "pointer",
              borderBottom: `2px solid ${tab === "settings" ? "var(--accent)" : "transparent"}`,
              marginBottom: -1,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>settings</span>
          </button>
        </div>

      {tab === "receitas" && (
        <div style={{ padding: 24 }}>
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
        </div>
      )}

      {tab === "settings" && (
        <div style={{ padding: 24 }}>
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
        </div>
      )}

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
          drinksMode={drinksMode}
          onModeChange={setDrinksMode}
          onAddDrink={addDrink}
          onUpdateDrink={updateDrink}
          onRemoveDrink={removeDrink}
          onDuplicateDrink={duplicateDrink}
          onAddItemToDrink={addItemToDrink}
          onUpdateItem={updateItem}
          onRemoveItem={removeItem}
          onUploadPhoto={async (drinkId, file) => {
            try {
              const photoDataUrl = await fileToDataUrlResized(file, {
                maxWidth: 1200,
                maxHeight: 1200,
                quality: 0.82,
              });
              updateDrink(drinkId, { photoDataUrl });
            } catch {
              const reader = new FileReader();
              reader.onload = () => {
                updateDrink(drinkId, { photoDataUrl: reader.result as string });
              };
              reader.readAsDataURL(file);
            }
          }}
        />
      )}

      {tab === "ingredients" && (
        <IngredientsTab
          ingredients={ingredients}
          drinks={drinks}
          settings={settings}
          activeIngredientId={activeIngredientId}
          activeIngredient={activeIngredient}
          setActiveIngredientId={setActiveIngredientId}
          onAddIngredient={addIngredient}
          onUpdateIngredient={updateIngredient}
          onDuplicateIngredient={duplicateIngredient}
          onRemoveIngredient={removeIngredient}
          onNavigateToDrink={(drinkId) => {
            setTab("drinks");
            setActiveDrinkId(drinkId);
          }}
        />
      )}
    </div>
  );
}
