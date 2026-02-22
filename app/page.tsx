"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";

/** Unidades que a receita pode usar */
type RecipeUnit = "ml" | "un" | "dash" | "drop";

/** Como precificar um ingrediente */
type PricingModel = "by_ml" | "by_bottle" | "by_unit";

/** Ingrediente (novo modelo) */
type Ingredient = {
  id: string;
  name: string;

  pricingModel: PricingModel;

  // by_ml:
  costPerMl?: number; // R$/ml

  // by_bottle:
  bottlePrice?: number; // R$ da garrafa
  bottleMl?: number; // ml nominal (ex 750)
  yieldMl?: number; // ml utilizável real (ex 720)
  lossPct?: number; // 0-100, perdas adicionais (opcional)

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
};

type Settings = {
  markup: number;
  targetCmv: number; // 0.2 = 20%
  dashMl: number; // ex 0.9
  dropMl: number; // ex 0.05 (ajuste ao seu dropper)
};

const STORAGE_KEY = "mixologia_drink_cost_v2";

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function safeNumber(input: string) {
  const v = Number(input.replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Calcula R$/ml do ingrediente conforme modelo */
function computeCostPerMl(ing: Ingredient): number | null {
  if (ing.pricingModel === "by_ml") {
    const v = ing.costPerMl ?? 0;
    return v > 0 ? v : 0;
  }
  if (ing.pricingModel === "by_bottle") {
    const price = ing.bottlePrice ?? 0;
    const bottleMl = ing.bottleMl ?? 0;
    const yieldMl = ing.yieldMl ?? bottleMl; // se não setar yield, usa nominal
    const lossPct = clamp(ing.lossPct ?? 0, 0, 100);

    const effectiveYield = yieldMl * (1 - lossPct / 100);
    if (price <= 0 || effectiveYield <= 0) return 0;

    return price / effectiveYield;
  }
  return null; // by_unit não tem R$/ml
}

/** Converte qty+unit da receita para custo em R$ */
function computeItemCost(
  item: RecipeItem,
  ing: Ingredient | undefined,
  settings: Settings
): number {
  if (!ing) return 0;

  if (item.unit === "un") {
    const cpu = ing.pricingModel === "by_unit" ? (ing.costPerUnit ?? 0) : 0;
    return item.qty * cpu;
  }

  // tudo que for ml/dash/drop vira ml primeiro
  const ml =
    item.unit === "ml"
      ? item.qty
      : item.unit === "dash"
      ? item.qty * settings.dashMl
      : item.qty * settings.dropMl;

  const cpm = computeCostPerMl(ing);
  if (cpm === null) return 0; // ingrediente por unidade sendo usado como ml/dash/drop -> custo 0 (você pode decidir bloquear)
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

/** CSV helpers (duas abas: ingredients + drinks_items/drinks_meta em um CSV só) */
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

function exportAsCsv(payload: ExportPayload) {
  // ingredientes
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

  // drinks meta + items (um CSV só, com "kind")
  const drinkRows: any[] = [];
  for (const d of payload.drinks) {
    drinkRows.push({
      kind: "drink",
      id: d.id,
      name: d.name,
      notes: d.notes ?? "",
      ingredientId: "",
      qty: "",
      unit: "",
    });
    d.items.forEach((it, idx) => {
      drinkRows.push({
        kind: "item",
        id: d.id,
        name: "",
        notes: "",
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
    },
  ];

  const csv1 = Papa.unparse(ingredientsRows);
  const csv2 = Papa.unparse(drinkRows);
  const csv3 = Papa.unparse(settingsRow);

  // empacota em “3 CSVs em 1” com separadores fáceis
  const combined =
    `###INGREDIENTS###\n${csv1}\n\n` +
    `###DRINKS###\n${csv2}\n\n` +
    `###SETTINGS###\n${csv3}\n`;

  downloadTextFile("mixologia_export.csv", combined);
}

function parseCombinedCsv(text: string): Partial<ExportPayload> {
  const sections = new Map<string, string>();
  const markers = ["###INGREDIENTS###", "###DRINKS###", "###SETTINGS###"];

  // split por marcadores
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
    const ings: Ingredient[] = (parsed.data || []).map((r) => ({
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
    }));
    out.ingredients = ings;
  }

  const drinksText = sections.get("###DRINKS###");
  if (drinksText) {
    const parsed = Papa.parse<any>(drinksText, { header: true, skipEmptyLines: true });
    const rows = parsed.data || [];

    const byDrink = new Map<string, Drink>();
    for (const r of rows) {
      const kind = String(r.kind || "").trim();
      const id = String(r.id || "").trim();
      if (!id) continue;

      if (kind === "drink") {
        byDrink.set(id, {
          id,
          name: String(r.name || "Drink"),
          notes: r.notes ? String(r.notes) : undefined,
          items: [],
        });
      }
    }
    for (const r of rows) {
      const kind = String(r.kind || "").trim();
      if (kind !== "item") continue;
      const id = String(r.id || "").trim();
      const d = byDrink.get(id);
      if (!d) continue;

      const ingredientId = String(r.ingredientId || "").trim();
      const qty = Number(r.qty);
      const unit = (String(r.unit || "ml") as RecipeUnit) || "ml";
      if (!ingredientId || !Number.isFinite(qty)) continue;

      d.items.push({ ingredientId, qty, unit });
    }

    out.drinks = Array.from(byDrink.values());
  }

  const settingsText = sections.get("###SETTINGS###");
  if (settingsText) {
    const parsed = Papa.parse<any>(settingsText, { header: true, skipEmptyLines: true });
    const r = (parsed.data || [])[0];
    if (r) {
      out.settings = {
        markup: Number(r.markup ?? 4),
        targetCmv: Number(r.targetCmv ?? 0.2),
        dashMl: Number(r.dashMl ?? 0.9),
        dropMl: Number(r.dropMl ?? 0.05),
      };
    }
  }

  return out;
}

export default function Page() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [settings, setSettings] = useState<Settings>({
    markup: 4,
    targetCmv: 0.2,
    dashMl: 0.9,
    dropMl: 0.05,
  });

  const [tab, setTab] = useState<"drinks" | "ingredients" | "settings">("drinks");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // load/save
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.ingredients) setIngredients(parsed.ingredients);
      if (parsed?.drinks) setDrinks(parsed.drinks);
      if (parsed?.settings) setSettings(parsed.settings);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ingredients, drinks, settings }));
    } catch {}
  }, [ingredients, drinks, settings]);

  // seed mínimo
  useEffect(() => {
    if (ingredients.length || drinks.length) return;

    const gin: Ingredient = {
      id: uid("ing"),
      name: "Gin (garrafa)",
      pricingModel: "by_bottle",
      bottlePrice: 120,
      bottleMl: 750,
      yieldMl: 720, // ex: perdas por ficar no fundo etc
      lossPct: 0,
    };

    const vermute: Ingredient = {
      id: uid("ing"),
      name: "Vermute Rosso (garrafa)",
      pricingModel: "by_bottle",
      bottlePrice: 80,
      bottleMl: 1000,
      yieldMl: 950,
      lossPct: 0,
    };

    const angostura: Ingredient = {
      id: uid("ing"),
      name: "Angostura (bitters)",
      pricingModel: "by_bottle",
      bottlePrice: 70,
      bottleMl: 200,
      yieldMl: 190,
      lossPct: 0,
      notes: "Use drop/dash na receita e ajuste Settings (ml por dash/gota) conforme seu padrão real.",
    };

    const orangePeel: Ingredient = {
      id: uid("ing"),
      name: "Casca de laranja (unidade)",
      pricingModel: "by_unit",
      costPerUnit: 0.4,
    };

    const hanky: Drink = {
      id: uid("drink"),
      name: "Hanky Panky",
      items: [
        { ingredientId: gin.id, qty: 45, unit: "ml" },
        { ingredientId: vermute.id, qty: 45, unit: "ml" },
        { ingredientId: angostura.id, qty: 1, unit: "dash" },
        { ingredientId: orangePeel.id, qty: 1, unit: "un" },
      ],
    };

    setIngredients([gin, vermute, angostura, orangePeel]);
    setDrinks([hanky]);
  }, [ingredients.length, drinks.length]);

  const ingredientMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const computed = useMemo(() => {
    return drinks.map((d) => {
      const cost = computeDrinkCost(d, ingredients, settings);
      const priceMarkup = cost * settings.markup;
      const priceCmv = settings.targetCmv > 0 ? cost / settings.targetCmv : 0;
      return { d, cost, priceMarkup, priceCmv };
    });
  }, [drinks, ingredients, settings]);

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
  };

  const updateIngredient = (id: string, patch: Partial<Ingredient>) => {
    setIngredients((p) => p.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const removeIngredient = (id: string) => {
    setIngredients((p) => p.filter((i) => i.id !== id));
    setDrinks((p) => p.map((d) => ({ ...d, items: d.items.filter((it) => it.ingredientId !== id) })));
  };

  const addDrink = () => {
    const d: Drink = { id: uid("drink"), name: "Novo drink", items: [] };
    setDrinks((p) => [d, ...p]);
    setTab("drinks");
  };

  const updateDrink = (id: string, patch: Partial<Drink>) => {
    setDrinks((p) => p.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const removeDrink = (id: string) => setDrinks((p) => p.filter((d) => d.id !== id));

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

  // CSV import
  const onImportFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCombinedCsv(text);

    if (parsed.ingredients) setIngredients(parsed.ingredients);
    if (parsed.drinks) setDrinks(parsed.drinks);
    if (parsed.settings) setSettings(parsed.settings);
  };

  // UI helpers
  const box: React.CSSProperties = { border: "1px solid #e6e6e6", borderRadius: 14, padding: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" };
  const btn: React.CSSProperties = { padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", cursor: "pointer" };
  const btnDanger: React.CSSProperties = { ...btn, borderColor: "#f2c2c2", background: "#fff5f5" };
  const input: React.CSSProperties = { width: "100%", padding: 8, borderRadius: 10, border: "1px solid #ddd" };
  const small: React.CSSProperties = { fontSize: 12, opacity: 0.8 };
  const tabBtn = (active: boolean): React.CSSProperties => ({ ...btn, background: active ? "#111" : "#fff", color: active ? "#fff" : "#111" });

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Custos de drinks (V2: garrafa+yields + dash/gota + CSV)</h1>
          <div style={small}>Padrão: salva no navegador. CSV: exporta/importa para compartilhar.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button style={btn} onClick={addDrink}>+ Drink</button>
          <button style={btn} onClick={addIngredient}>+ Ingrediente</button>

          <button
            style={btn}
            onClick={() => exportAsCsv({ ingredients, drinks, settings })}
          >
            Exportar CSV
          </button>

          <button style={btn} onClick={() => fileRef.current?.click()}>
            Importar CSV
          </button>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f);
              e.currentTarget.value = "";
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button style={tabBtn(tab === "drinks")} onClick={() => setTab("drinks")}>Drinks</button>
        <button style={tabBtn(tab === "ingredients")} onClick={() => setTab("ingredients")}>Ingredientes</button>
        <button style={tabBtn(tab === "settings")} onClick={() => setTab("settings")}>Configurações</button>
      </div>

      {tab === "settings" && (
        <div style={box}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Conversões e precificação</h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            <div>
              <div style={small}>Markup (x)</div>
              <input style={input} inputMode="decimal" value={String(settings.markup)} onChange={(e) => setSettings(s => ({ ...s, markup: clamp(safeNumber(e.target.value), 0, 100) }))} />
            </div>

            <div>
              <div style={small}>CMV alvo (%)</div>
              <input style={input} inputMode="decimal" value={String(Math.round(settings.targetCmv * 100))} onChange={(e) => setSettings(s => ({ ...s, targetCmv: clamp(safeNumber(e.target.value), 1, 100) / 100 }))} />
            </div>

            <div>
              <div style={small}>1 dash = (ml)</div>
              <input style={input} inputMode="decimal" value={String(settings.dashMl)} onChange={(e) => setSettings(s => ({ ...s, dashMl: clamp(safeNumber(e.target.value), 0, 10) }))} />
            </div>

            <div>
              <div style={small}>1 gota = (ml)</div>
              <input style={input} inputMode="decimal" value={String(settings.dropMl)} onChange={(e) => setSettings(s => ({ ...s, dropMl: clamp(safeNumber(e.target.value), 0, 1) }))} />
            </div>
          </div>

          <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "14px 0" }} />

          <button
            style={btnDanger}
            onClick={() => {
              if (confirm("Apagar todos os dados salvos no navegador?")) {
                localStorage.removeItem(STORAGE_KEY);
                setIngredients([]);
                setDrinks([]);
                setSettings({ markup: 4, targetCmv: 0.2, dashMl: 0.9, dropMl: 0.05 });
              }
            }}
          >
            Resetar tudo
          </button>
        </div>
      )}

      {tab === "ingredients" && (
        <div style={box}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Ingredientes</h2>

          {ingredients.length === 0 ? (
            <div style={{ padding: 14, border: "1px dashed #ddd", borderRadius: 14, opacity: 0.8 }}>
              Sem ingredientes. Clique em “+ Ingrediente”.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ingredients.map((ing) => {
                const cpm = computeCostPerMl(ing);
                return (
                  <div key={ing.id} style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                      <input style={input} value={ing.name} onChange={(e) => updateIngredient(ing.id, { name: e.target.value })} />
                      <select
                        style={input}
                        value={ing.pricingModel}
                        onChange={(e) => updateIngredient(ing.id, { pricingModel: e.target.value as PricingModel })}
                      >
                        <option value="by_bottle">Por garrafa (R$ + ml + yield)</option>
                        <option value="by_ml">Direto R$/ml</option>
                        <option value="by_unit">Por unidade (garnish, etc.)</option>
                      </select>
                    </div>

                    {ing.pricingModel === "by_bottle" && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 10 }}>
                        <div>
                          <div style={small}>Preço (R$)</div>
                          <input style={input} inputMode="decimal" value={String(ing.bottlePrice ?? "")} onChange={(e) => updateIngredient(ing.id, { bottlePrice: safeNumber(e.target.value) })} />
                        </div>
                        <div>
                          <div style={small}>ml nominal</div>
                          <input style={input} inputMode="decimal" value={String(ing.bottleMl ?? "")} onChange={(e) => updateIngredient(ing.id, { bottleMl: safeNumber(e.target.value) })} />
                        </div>
                        <div>
                          <div style={small}>yield real (ml)</div>
                          <input style={input} inputMode="decimal" value={String(ing.yieldMl ?? "")} onChange={(e) => updateIngredient(ing.id, { yieldMl: safeNumber(e.target.value) })} />
                        </div>
                        <div>
                          <div style={small}>perdas (%)</div>
                          <input style={input} inputMode="decimal" value={String(ing.lossPct ?? 0)} onChange={(e) => updateIngredient(ing.id, { lossPct: safeNumber(e.target.value) })} />
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <div style={small}>R$/ml calculado</div>
                          <div style={{ fontSize: 16 }}>{formatBRL(cpm ?? 0)} / ml</div>
                        </div>
                      </div>
                    )}

                    {ing.pricingModel === "by_ml" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                        <div>
                          <div style={small}>R$/ml</div>
                          <input style={input} inputMode="decimal" value={String(ing.costPerMl ?? "")} onChange={(e) => updateIngredient(ing.id, { costPerMl: safeNumber(e.target.value) })} />
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-end" }}>
                          <div style={{ fontSize: 16 }}>{formatBRL(computeCostPerMl(ing) ?? 0)} / ml</div>
                        </div>
                      </div>
                    )}

                    {ing.pricingModel === "by_unit" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                        <div>
                          <div style={small}>R$ por unidade</div>
                          <input style={input} inputMode="decimal" value={String(ing.costPerUnit ?? "")} onChange={(e) => updateIngredient(ing.id, { costPerUnit: safeNumber(e.target.value) })} />
                        </div>
                      </div>
                    )}

                    <div style={{ marginTop: 10 }}>
                      <textarea style={{ ...input, minHeight: 60 }} value={ing.notes ?? ""} placeholder="Notas (opcional)" onChange={(e) => updateIngredient(ing.id, { notes: e.target.value })} />
                    </div>

                    <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                      <button style={btnDanger} onClick={() => removeIngredient(ing.id)}>Remover</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "drinks" && (
        <div style={box}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Drinks</h2>

          {computed.length === 0 ? (
            <div style={{ padding: 14, border: "1px dashed #ddd", borderRadius: 14, opacity: 0.8 }}>
              Sem drinks. Clique em “+ Drink”.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {computed.map(({ d, cost, priceMarkup, priceCmv }) => (
                <div key={d.id} style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
                  <input style={input} value={d.name} onChange={(e) => updateDrink(d.id, { name: e.target.value })} />

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 10 }}>
                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                      <div style={small}>Custo</div>
                      <div style={{ fontSize: 18 }}>{formatBRL(cost)}</div>
                    </div>
                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                      <div style={small}>Preço (markup {settings.markup}x)</div>
                      <div style={{ fontSize: 18 }}>{formatBRL(priceMarkup)}</div>
                    </div>
                    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                      <div style={small}>Preço (CMV {Math.round(settings.targetCmv * 100)}%)</div>
                      <div style={{ fontSize: 18 }}>{formatBRL(priceCmv)}</div>
                    </div>
                  </div>

                  <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "12px 0" }} />

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <strong>Receita</strong>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={btn} onClick={() => addItemToDrink(d.id)} disabled={!ingredients.length}>+ Item</button>
                      <button style={btnDanger} onClick={() => removeDrink(d.id)}>Remover drink</button>
                    </div>
                  </div>

                  {d.items.length === 0 ? (
                    <div style={{ marginTop: 10, padding: 14, border: "1px dashed #ddd", borderRadius: 14, opacity: 0.8 }}>
                      Sem itens. Clique em “+ Item”.
                    </div>
                  ) : (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      {d.items.map((it, idx) => {
                        const ing = ingredientMap.get(it.ingredientId);
                        const cpm = ing ? computeCostPerMl(ing) : null;
                        const perUnit = ing?.pricingModel === "by_unit" ? (ing.costPerUnit ?? 0) : 0;

                        const hint =
                          it.unit === "un"
                            ? `${formatBRL(perUnit)} / un`
                            : `${formatBRL(cpm ?? 0)} / ml`;

                        return (
                          <div key={`${d.id}_${idx}`} style={{ display: "grid", gridTemplateColumns: "2fr 0.8fr 0.8fr 1fr 0.8fr", gap: 8, alignItems: "center" }}>
                            <select
                              style={input}
                              value={it.ingredientId}
                              onChange={(e) => updateItem(d.id, idx, { ingredientId: e.target.value })}
                            >
                              {ingredients.map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.name}
                                </option>
                              ))}
                            </select>

                            <input
                              style={input}
                              inputMode="decimal"
                              value={String(it.qty)}
                              onChange={(e) => updateItem(d.id, idx, { qty: safeNumber(e.target.value) })}
                            />

                            <select
                              style={input}
                              value={it.unit}
                              onChange={(e) => updateItem(d.id, idx, { unit: e.target.value as RecipeUnit })}
                            >
                              <option value="ml">ml</option>
                              <option value="dash">dash</option>
                              <option value="drop">gota</option>
                              <option value="un">un</option>
                            </select>

                            <div style={small}>{hint}</div>

                            <button style={btnDanger} onClick={() => removeItem(d.id, idx)}>Remover</button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div style={{ marginTop: 10 }}>
                    <textarea style={{ ...input, minHeight: 60 }} value={d.notes ?? ""} placeholder="Notas (opcional)" onChange={(e) => updateDrink(d.id, { notes: e.target.value })} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}