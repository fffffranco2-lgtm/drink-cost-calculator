/**
 * CSV import/export helpers para o admin.
 * Extraído de app/admin/page.tsx para manter a página focada em orquestração.
 */

import Papa from "papaparse";
import {
  type Drink,
  type ExportPayload,
  type RecipeUnit,
  type RoundingMode,
  normalizeDrink,
  normalizeIngredients,
  normalizeSettings,
} from "@/app/admin/admin-types";

/* ---------------------- download helper ---------------------- */

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

/* ---------------------- export ---------------------- */

export function exportAsCsv(payload: ExportPayload) {
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

  type DrinkRow = {
    kind: "drink" | "item";
    id: string;
    name?: string;
    notes?: string;
    showOnPublicMenu?: string;
    publicMenuPriceMode?: string;
    manualPublicPrice?: number | string;
    ingredientId?: string;
    qty?: number | string;
    unit?: string;
    itemIndex?: number;
  };

  const drinkRows: DrinkRow[] = [];
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

/* ---------------------- parse ---------------------- */

type RawDrinkRow = {
  kind?: string;
  id?: string;
  name?: string;
  notes?: string;
  showOnPublicMenu?: string;
  publicMenuPriceMode?: string;
  manualPublicPrice?: string | number;
  ingredientId?: string;
  qty?: string | number;
  unit?: string;
};

type RawSettingsRow = {
  markup?: string | number;
  targetCmv?: string | number;
  dashMl?: string | number;
  dropMl?: string | number;
  publicMenuPriceVisibility?: string;
  showPublicMenuGarnish?: string | boolean;
  publicMenuPriceMode?: string;
  roundingMode?: string;
};

export function parseCombinedCsv(text: string): Partial<ExportPayload> {
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
    const parsed = Papa.parse<Record<string, unknown>>(ingText, { header: true, skipEmptyLines: true });
    out.ingredients = normalizeIngredients(parsed.data);
  }

  const drinksText = sections.get("###DRINKS###");
  if (drinksText) {
    const parsed = Papa.parse<RawDrinkRow>(drinksText, { header: true, skipEmptyLines: true });
    const rows = parsed.data || [];

    const byDrink = new Map<string, Drink>();
    for (const r of rows) {
      if (String(r.kind || "").trim() !== "drink") continue;
      const id = String(r.id || "").trim();
      if (!id) continue;
      const mode = String(r.publicMenuPriceMode || "").toLowerCase();
      byDrink.set(id, {
        id,
        name: String(r.name || "Drink"),
        notes: r.notes ? String(r.notes) : undefined,
        showOnPublicMenu: String(r.showOnPublicMenu || "").toLowerCase() === "true",
        publicMenuPriceMode:
          mode === "cmv" ? "cmv" : mode === "manual" ? "manual" : "markup",
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
    const parsed = Papa.parse<RawSettingsRow>(settingsText, { header: true, skipEmptyLines: true });
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
