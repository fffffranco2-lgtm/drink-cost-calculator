"use client";

import React, { useMemo, useState } from "react";
import { formatBRL } from "@/lib/utils";
import { NumberField } from "@/app/admin/components/NumberField";
import { Drawer } from "@/app/admin/components/Drawer";
import { DrawerHeader } from "@/app/admin/components/DrawerHeader";
import { SegmentedControl } from "@/app/admin/components/SegmentedControl";
import {
  type Drink,
  type DrinksPanelMode,
  type Ingredient,
  type RecipeItem,
  type RecipeUnit,
  type Settings,
  INGREDIENT_CATEGORY_LABEL,
  applyPsychRounding,
  computeItemCost,
} from "@/app/admin/admin-types";

/* ─── tipos ──────────────────────────────────────────────────────────── */

export type DrinksTabProps = {
  drinks: Drink[];
  ingredients: Ingredient[];
  activeDrinkId: string | null;
  activeDrink: Drink | null;
  setActiveDrinkId: React.Dispatch<React.SetStateAction<string | null>>;
  computedByDrinkId: Map<string, { cost: number; priceMarkup: number; priceCmv: number }>;
  ingredientMap: Map<string, Ingredient>;
  ingredientGroups: { category: Ingredient["category"]; items: Ingredient[] }[];
  settings: Settings;
  drinksMode: DrinksPanelMode;
  onModeChange: (mode: DrinksPanelMode) => void;
  onAddDrink: () => void;
  onUpdateDrink: (id: string, patch: Partial<Drink>) => void;
  onRemoveDrink: (id: string) => void;
  onDuplicateDrink: (id: string) => void;
  onAddItemToDrink: (drinkId: string) => void;
  onUpdateItem: (drinkId: string, idx: number, patch: Partial<RecipeItem>) => void;
  onRemoveItem: (drinkId: string, idx: number) => void;
  onUploadPhoto: (drinkId: string, file: File) => Promise<void>;
};

/* ─── constantes ─────────────────────────────────────────────────────── */

const DOT_COLORS = [
  "#0f766e", "#8e3e36", "#065f46", "#7c3aed",
  "#b45309", "#1e40af", "#9d174d", "#166534",
];

/* ─── helpers ────────────────────────────────────────────────────────── */

function sectTitle(): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--muted)",
    margin: 0,
  };
}

function mono(size = 13): React.CSSProperties {
  return {
    fontFamily: "var(--font-app-mono), monospace",
    fontSize: size,
    fontWeight: 500,
  };
}

function getEffectivePrice(drink: Drink, cost: number, settings: Settings): number {
  const mode = drink.pricingMode ?? "markup";
  if (mode === "manual") return drink.manualPublicPrice ?? 0;
  const markup = drink.markupMultiplier ?? settings.markup;
  const cmv = drink.cmvTarget ?? settings.targetCmv;
  if (mode === "cmv") return applyPsychRounding(cmv > 0 ? cost / cmv : 0, settings.roundingMode);
  return applyPsychRounding(cost * markup, settings.roundingMode);
}

/* ─── HeroStats ──────────────────────────────────────────────────────── */

function HeroStats({
  drinks,
  computedByDrinkId,
  settings,
}: {
  drinks: Drink[];
  computedByDrinkId: Map<string, { cost: number; priceMarkup: number; priceCmv: number }>;
  settings: Settings;
}) {
  const stats = useMemo(() => {
    if (!drinks.length) return null;
    let totalCost = 0, totalPrice = 0, count = 0;
    for (const d of drinks) {
      const c = computedByDrinkId.get(d.id);
      if (!c) continue;
      const price = getEffectivePrice(d, c.cost, settings);
      totalCost += c.cost;
      totalPrice += price;
      count++;
    }
    if (!count) return null;
    const avgCost = totalCost / count;
    const avgPrice = totalPrice / count;
    const avgMargin = avgPrice - avgCost;
    const avgCmv = avgPrice > 0 ? (avgCost / avgPrice) * 100 : 0;
    return { avgCost, avgPrice, avgMargin, avgCmv, count };
  }, [drinks, computedByDrinkId, settings]);

  if (!stats) return null;

  const tile = (label: string, value: string, sub: string, color?: string) => (
    <div key={label}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ ...mono(16), fontWeight: 600, letterSpacing: "-0.01em", color: color ?? "var(--foreground)" }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: "var(--muted)" }}>{sub}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
      {tile("Custo médio", formatBRL(stats.avgCost), `em ${stats.count} drinks`)}
      {tile("Preço médio", formatBRL(stats.avgPrice), "público")}
      {tile(
        "Margem média",
        formatBRL(stats.avgMargin),
        `${stats.avgPrice > 0 ? ((stats.avgMargin / stats.avgPrice) * 100).toFixed(0) : 0}% sobre preço`,
        "#065f46",
      )}
      {tile(
        "CMV médio",
        `${stats.avgCmv.toFixed(1)}%`,
        `alvo ${Math.round(settings.targetCmv * 100)}%`,
        stats.avgCmv > settings.targetCmv * 100 ? "var(--terracota)" : "var(--foreground)",
      )}
    </div>
  );
}

/* ─── DrinkCard ──────────────────────────────────────────────────────── */

function DrinkCard({
  drink,
  mode,
  active,
  cost,
  price,
  onClick,
}: {
  drink: Drink;
  mode: DrinksPanelMode;
  active: boolean;
  cost: number;
  price: number;
  onClick: () => void;
}) {
  const margin = price - cost;
  const marginPct = price > 0 ? (margin / price) * 100 : 0;
  const cmvReal = price > 0 ? (cost / price) * 100 : 0;
  const lowMargin = mode === "pricing" && (margin < 0 || marginPct < 15);

  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 12,
        border: `1px solid ${active ? "var(--accent)" : lowMargin ? "color-mix(in srgb, var(--terracota) 35%, var(--line))" : "var(--line)"}`,
        backgroundColor: "var(--surface)",
        cursor: "pointer",
        overflow: "hidden",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        boxShadow: active ? "0 0 0 3px var(--focus)" : "none",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          const el = e.currentTarget as HTMLDivElement;
          el.style.transform = "translateY(-1px)";
          el.style.boxShadow = "var(--shadow)";
          el.style.borderColor = "color-mix(in srgb, var(--accent) 30%, var(--line))";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          const el = e.currentTarget as HTMLDivElement;
          el.style.transform = "translateY(0)";
          el.style.boxShadow = "none";
          el.style.borderColor = lowMargin
            ? "color-mix(in srgb, var(--terracota) 35%, var(--line))"
            : "var(--line)";
        }
      }}
    >
      {/* Photo 16:10 */}
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 10",
          overflow: "hidden",
          background: drink.photoDataUrl
            ? undefined
            : "linear-gradient(135deg, var(--surface-alt) 0%, var(--line) 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {drink.photoDataUrl ? (
          <img src={drink.photoDataUrl} alt={drink.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span className="material-symbols-rounded" style={{ fontSize: 28, color: "var(--muted)", opacity: 0.4 }}>
            local_bar
          </span>
        )}
        {!drink.showOnPublicMenu && (
          <span
            style={{
              position: "absolute", top: 8, right: 8,
              background: "rgba(255,255,255,0.9)", color: "var(--muted)",
              fontSize: 10, padding: "3px 7px", borderRadius: 4,
              fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
            }}
          >
            oculto
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "10px 12px 12px" }}>
        <p
          style={{
            margin: "0 0 6px",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {drink.name || "Sem nome"}
        </p>

        {mode === "editor" ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", ...mono(11), color: "var(--muted)" }}>
            <span style={{ fontFamily: "inherit" }}>
              {drink.items.length} ingrediente{drink.items.length !== 1 ? "s" : ""}
            </span>
            <span style={{ color: "var(--foreground)" }}>{formatBRL(cost)}</span>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", ...mono(11), color: "var(--muted)", marginBottom: 3 }}>
              <span>Custo</span>
              <span style={{ color: "var(--foreground)" }}>{formatBRL(cost)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", ...mono(11), color: "var(--muted)" }}>
              <span>Preço</span>
              <span style={{ color: price > 0 ? "var(--foreground)" : "var(--terracota)" }}>
                {price > 0 ? formatBRL(price) : "—"}
              </span>
            </div>
            <div
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: "1px solid var(--line)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                  Margem
                </div>
                <div style={{ ...mono(14), fontWeight: 600, color: "#065f46" }}>{formatBRL(margin)}</div>
              </div>
              <div style={{ ...mono(11), color: "var(--muted)", textAlign: "right", lineHeight: 1.3 }}>
                {cmvReal.toFixed(0)}%<br />CMV
              </div>
            </div>
            <div style={{ height: 3, background: "var(--background)", borderRadius: 2, overflow: "hidden", marginTop: 6 }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(100, Math.max(0, marginPct))}%`,
                  background: "var(--accent)",
                  borderRadius: 2,
                  transition: "width 300ms ease",
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── CostBlock ──────────────────────────────────────────────────────── */

function CostBlock({ cost }: { cost: number }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 12,
        backgroundColor: "var(--surface-alt)",
        border: "1px solid var(--line)",
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Custo da receita
        </div>
        <div style={{ ...mono(22), fontWeight: 600, letterSpacing: "-0.02em", marginTop: 4 }}>
          {formatBRL(cost)}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "right", maxWidth: 140, lineHeight: 1.4 }}>
        troque pra{" "}
        <b style={{ color: "var(--accent-strong)" }}>Precificar</b>
        {" "}para definir preço
      </div>
    </div>
  );
}

/* ─── PriceBlock ─────────────────────────────────────────────────────── */

function PriceBlock({
  drink,
  cost,
  settings,
  onUpdateDrink,
}: {
  drink: Drink;
  cost: number;
  settings: Settings;
  onUpdateDrink: (id: string, patch: Partial<Drink>) => void;
}) {
  const activeMode = drink.pricingMode ?? "markup";
  const markup = drink.markupMultiplier ?? settings.markup;
  const cmv = drink.cmvTarget ?? settings.targetCmv;

  const priceMarkup = applyPsychRounding(cost * markup, settings.roundingMode);
  const priceCmv = applyPsychRounding(cmv > 0 ? cost / cmv : 0, settings.roundingMode);
  const priceManual = drink.manualPublicPrice ?? 0;

  const activePrice = activeMode === "manual" ? priceManual : activeMode === "cmv" ? priceCmv : priceMarkup;
  const margin = activePrice - cost;
  const cmvReal = activePrice > 0 ? (cost / activePrice) * 100 : 0;

  const option = (value: typeof activeMode, label: string, price: number, sublabel: string) => {
    const isActive = activeMode === value;
    return (
      <button
        key={value}
        onClick={() => onUpdateDrink(drink.id, { pricingMode: value })}
        style={{
          padding: "8px 10px",
          border: `1px solid ${isActive ? "var(--accent)" : "var(--line)"}`,
          background: isActive ? "var(--accent-soft)" : "var(--surface)",
          borderRadius: 8,
          cursor: "pointer",
          textAlign: "left",
          flex: 1,
          minWidth: 0,
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: isActive ? "var(--accent-strong)" : "var(--muted)", marginBottom: 2 }}>
          {label}
        </div>
        <div style={{ ...mono(15), fontWeight: 600, color: price > 0 ? "var(--foreground)" : "var(--muted)" }}>
          {value === "manual" && priceManual === 0 ? "—" : formatBRL(price)}
        </div>
        <div style={{ ...mono(10), color: isActive ? "var(--accent-strong)" : "var(--muted)", marginTop: 2 }}>
          {sublabel}
        </div>
      </button>
    );
  };

  return (
    <div
      style={{
        background: "var(--surface-alt)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
        Modelo de Precificação
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {option("markup", `Markup ${markup}x`, priceMarkup, `+${formatBRL(priceMarkup - cost)}`)}
        {option("cmv", `CMV ${Math.round(cmv * 100)}%`, priceCmv, `+${formatBRL(priceCmv - cost)}`)}
        {option("manual", "Manual", priceManual, "definir")}
      </div>

      {activeMode === "manual" && (
        <input
          type="number"
          step="0.01"
          min={0}
          style={{
            width: "100%",
            padding: "9px 11px",
            borderRadius: 7,
            border: "1px solid var(--line)",
            background: "var(--background)",
            fontFamily: "var(--font-app-mono), monospace",
            fontSize: 13,
            outline: "none",
            marginBottom: 10,
            boxSizing: "border-box",
          }}
          value={priceManual || ""}
          placeholder="Preço manual (R$)"
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onUpdateDrink(drink.id, { manualPublicPrice: Number.isFinite(v) ? v : 0 });
          }}
        />
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 8,
          paddingTop: 10,
          borderTop: "1px dashed var(--line)",
        }}
      >
        <div>
          <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 2 }}>Custo</div>
          <div style={{ ...mono(13), fontWeight: 600 }}>{formatBRL(cost)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 2 }}>Margem</div>
          <div style={{ ...mono(13), fontWeight: 600, color: "#065f46" }}>{formatBRL(margin)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 2 }}>CMV Real</div>
          <div style={{ ...mono(13), fontWeight: 600, color: cmvReal > 35 ? "var(--terracota)" : "var(--foreground)" }}>
            {cmvReal.toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── RecipeSection ──────────────────────────────────────────────────── */

function RecipeSection({
  drink,
  mode,
  ingredients,
  ingredientMap,
  ingredientGroups,
  settings,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
}: {
  drink: Drink;
  mode: DrinksPanelMode;
  ingredients: Ingredient[];
  ingredientMap: Map<string, Ingredient>;
  ingredientGroups: { category: Ingredient["category"]; items: Ingredient[] }[];
  settings: Settings;
  onAddItem: () => void;
  onUpdateItem: (idx: number, patch: Partial<RecipeItem>) => void;
  onRemoveItem: (idx: number) => void;
}) {
  const [hoverRemove, setHoverRemove] = useState<number | null>(null);

  const totalCost = useMemo(
    () => drink.items.reduce((sum, it) => sum + computeItemCost(it, ingredientMap.get(it.ingredientId), settings), 0),
    [drink.items, ingredientMap, settings],
  );

  const rowInput: React.CSSProperties = {
    border: "1px solid var(--line)",
    borderRadius: 6,
    padding: "5px 7px",
    background: "var(--background)",
    fontFamily: "inherit",
    fontSize: 11,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={sectTitle()}>
          {mode === "pricing" ? "Receita — onde o custo está" : "Receita"}
        </span>
        {mode === "editor" && (
          <button
            onClick={onAddItem}
            disabled={!ingredients.length}
            style={{
              fontFamily: "inherit",
              padding: "3px 8px",
              border: "1px solid var(--line)",
              background: "transparent",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              color: "var(--accent-strong)",
              cursor: ingredients.length ? "pointer" : "default",
              opacity: ingredients.length ? 1 : 0.4,
            }}
          >
            + ingrediente
          </button>
        )}
      </div>

      {drink.items.length === 0 ? (
        <div
          style={{
            padding: 14,
            border: "1px dashed var(--line)",
            borderRadius: 8,
            textAlign: "center",
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          Nenhum ingrediente. Clique em "+ ingrediente".
        </div>
      ) : (
        <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", background: "var(--surface)" }}>
          {/* Breakdown bar — pricing mode only */}
          {mode === "pricing" && totalCost > 0 && (
            <div style={{ display: "flex", height: 6, borderBottom: "1px solid var(--line)" }}>
              {drink.items.map((it, idx) => {
                const itemCost = computeItemCost(it, ingredientMap.get(it.ingredientId), settings);
                const pct = (itemCost / totalCost) * 100;
                return (
                  <div
                    key={idx}
                    style={{ flex: pct, background: DOT_COLORS[idx % DOT_COLORS.length] }}
                  />
                );
              })}
            </div>
          )}

          {/* Rows */}
          {drink.items.map((it, idx) => {
            const ing = ingredientMap.get(it.ingredientId);
            const itemCost = computeItemCost(it, ing, settings);
            const pct = totalCost > 0 ? (itemCost / totalCost) * 100 : 0;
            const dotColor = DOT_COLORS[idx % DOT_COLORS.length];
            const cols = mode === "pricing"
              ? "10px 1fr 60px 50px 72px 24px"
              : "1fr 64px 54px 68px 24px";

            return (
              <div
                key={`${drink.id}_${idx}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: cols,
                  gap: 6,
                  alignItems: "center",
                  padding: "8px 10px",
                  borderTop: idx === 0 ? "none" : "1px solid var(--line)",
                }}
              >
                {mode === "pricing" && (
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: dotColor, flexShrink: 0 }} />
                )}

                <select
                  style={rowInput}
                  value={it.ingredientId}
                  onChange={(e) => onUpdateItem(idx, { ingredientId: e.target.value })}
                >
                  {ingredientGroups.map((group) => (
                    <optgroup key={group.category} label={INGREDIENT_CATEGORY_LABEL[group.category]}>
                      {group.items.map((i) => (
                        <option key={i.id} value={i.id}>{i.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>

                <NumberField
                  style={rowInput}
                  value={it.qty}
                  decimals={it.unit === "ml" ? 0 : 2}
                  min={0}
                  onCommit={(n) => onUpdateItem(idx, { qty: n })}
                />

                <select
                  style={rowInput}
                  value={it.unit}
                  onChange={(e) => onUpdateItem(idx, { unit: e.target.value as RecipeUnit })}
                >
                  <option value="ml">ml</option>
                  <option value="dash">dash</option>
                  <option value="drop">gota</option>
                  <option value="un">un</option>
                </select>

                <div style={{ ...mono(11), textAlign: "right", color: mode === "pricing" ? "var(--foreground)" : "var(--muted)", lineHeight: 1.3 }}>
                  {formatBRL(itemCost)}
                  {mode === "pricing" && (
                    <span style={{ display: "block", fontSize: 9, color: "var(--muted)" }}>{pct.toFixed(0)}%</span>
                  )}
                </div>

                <button
                  onClick={() => onRemoveItem(idx)}
                  onMouseEnter={() => setHoverRemove(idx)}
                  onMouseLeave={() => setHoverRemove(null)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: hoverRemove === idx ? "var(--danger)" : "var(--muted)",
                    cursor: "pointer",
                    padding: 3,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <span
                    className="material-symbols-rounded"
                    style={{ fontSize: 14, fontVariationSettings: '"FILL" 0, "wght" 500' }}
                  >
                    close
                  </span>
                </button>
              </div>
            );
          })}

          {/* Footer — editor mode only */}
          {mode === "editor" && (
            <div
              style={{
                borderTop: "1px solid var(--line)",
                padding: "10px 12px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "var(--surface-alt)",
                fontSize: 11,
              }}
            >
              <span style={{ color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 10 }}>
                Custo total
              </span>
              <span style={{ ...mono(13), fontWeight: 600 }}>{formatBRL(totalCost)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── DrinksTab ──────────────────────────────────────────────────────── */

export function DrinksTab({
  drinks,
  ingredients,
  activeDrinkId,
  activeDrink,
  setActiveDrinkId,
  computedByDrinkId,
  ingredientMap,
  ingredientGroups,
  settings,
  drinksMode,
  onModeChange,
  onAddDrink,
  onUpdateDrink,
  onRemoveDrink,
  onDuplicateDrink,
  onAddItemToDrink,
  onUpdateItem,
  onRemoveItem,
  onUploadPhoto,
}: DrinksTabProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"todos" | "cardapio" | "ocultos" | "rascunho" | "margem-baixa" | "alertas">("todos");

  const filteredDrinks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drinks.filter((d) => {
      if (q && !d.name.toLowerCase().includes(q)) return false;
      if (filter === "cardapio") return d.showOnPublicMenu;
      if (filter === "ocultos") return !d.showOnPublicMenu;
      if (filter === "rascunho") return d.items.length === 0;
      if (filter === "margem-baixa") {
        const c = computedByDrinkId.get(d.id);
        if (!c) return false;
        const price = getEffectivePrice(d, c.cost, settings);
        const marginPct = price > 0 ? ((price - c.cost) / price) * 100 : 0;
        return marginPct < 20;
      }
      if (filter === "alertas") return d.items.some((it) => !ingredientMap.get(it.ingredientId));
      return true;
    });
  }, [drinks, search, filter, computedByDrinkId, settings, ingredientMap]);

  const editorFilters: { value: typeof filter; label: string }[] = [
    { value: "todos", label: "Todos" },
    { value: "cardapio", label: "No cardápio" },
    { value: "ocultos", label: "Ocultos" },
    { value: "rascunho", label: "Rascunhos" },
  ];

  const pricingFilters: { value: typeof filter; label: string }[] = [
    { value: "todos", label: "Todos" },
    { value: "cardapio", label: "No cardápio" },
    { value: "margem-baixa", label: "Margem baixa" },
    { value: "alertas", label: "Alertas" },
  ];

  const filters = drinksMode === "editor" ? editorFilters : pricingFilters;
  const activeCost = activeDrink ? (computedByDrinkId.get(activeDrink.id)?.cost ?? 0) : 0;
  const menuCount = drinks.filter((d) => d.showOnPublicMenu).length;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* ModeBar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          padding: "14px 24px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>Drinks</h2>
        <SegmentedControl
          options={[
            { value: "editor", label: "Editar receita", icon: "edit_note" },
            { value: "pricing", label: "Precificar", icon: "sell" },
          ]}
          value={drinksMode}
          onChange={onModeChange}
        />
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {drinksMode === "editor" ? "Monte ingredientes e preparo" : "Defina preço, margem e CMV"}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {drinks.length} drink{drinks.length !== 1 ? "s" : ""} · {menuCount} no cardápio
        </span>
      </div>

      {/* Hero stats — pricing only */}
      {drinksMode === "pricing" && (
        <div
          style={{
            padding: "14px 24px",
            background: "var(--surface-alt)",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <HeroStats drinks={drinks} computedByDrinkId={computedByDrinkId} settings={settings} />
        </div>
      )}

      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          padding: "10px 24px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        {/* Filtros */}
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: `1px solid ${filter === f.value ? "var(--accent-soft)" : "var(--line)"}`,
              backgroundColor: filter === f.value ? "var(--accent-soft)" : "transparent",
              color: filter === f.value ? "var(--accent-strong)" : "var(--muted)",
              fontWeight: filter === f.value ? 600 : 500,
              fontSize: 12,
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontFamily: "inherit",
            }}
          >
            {f.label}
          </button>
        ))}

        {/* Novo drink — pill-add */}
        <button
          onClick={onAddDrink}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "6px 12px 6px 10px",
            borderRadius: 999,
            border: "1px dashed var(--accent)",
            backgroundColor: "var(--accent-soft)",
            color: "var(--accent-strong)",
            fontWeight: 600,
            fontSize: 12,
            cursor: "pointer",
            whiteSpace: "nowrap",
            fontFamily: "inherit",
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 16, fontVariationSettings: '"FILL" 0, "wght" 500' }}>
            add
          </span>
          Novo drink
        </button>

        <div style={{ flex: 1 }} />

        {/* Busca */}
        <div style={{ position: "relative" }}>
          <span
            className="material-symbols-rounded"
            style={{
              position: "absolute",
              left: 8,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 16,
              color: "var(--muted)",
              pointerEvents: "none",
            }}
          >
            search
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar drink..."
            style={{
              width: 200,
              padding: "7px 10px 7px 30px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--background)",
              fontFamily: "inherit",
              fontSize: 12,
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* Split: grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: activeDrink ? "1fr 500px" : "1fr",
          alignItems: "start",
          flex: 1,
          padding: "20px 24px 24px",
        }}
      >
        {/* Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
            gap: 14,
            alignContent: "start",
            paddingRight: activeDrink ? 20 : 0,
          }}
        >
          {filteredDrinks.length === 0 ? (
            <div
              style={{
                gridColumn: "1 / -1",
                padding: 32,
                border: "1px dashed var(--line)",
                borderRadius: 12,
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 13,
              }}
            >
              {search || filter !== "todos"
                ? "Nenhum drink encontrado com esses filtros."
                : 'Nenhum drink ainda. Clique em "Novo drink" para começar.'}
            </div>
          ) : (
            filteredDrinks.map((d) => {
              const c = computedByDrinkId.get(d.id);
              const cost = c?.cost ?? 0;
              const price = c ? getEffectivePrice(d, cost, settings) : 0;
              return (
                <DrinkCard
                  key={d.id}
                  drink={d}
                  mode={drinksMode}
                  active={d.id === activeDrinkId}
                  cost={cost}
                  price={price}
                  onClick={() => setActiveDrinkId(d.id)}
                />
              );
            })
          )}
        </div>

        {/* Drawer */}
        {activeDrink && (
          <Drawer>
            <DrawerHeader
              breadcrumb="Cardápio"
              activeLabel={activeDrink.name || "Sem nome"}
              name={activeDrink.name}
              onNameChange={(v) => onUpdateDrink(activeDrink.id, { name: v })}
              onDuplicate={() => onDuplicateDrink(activeDrink.id)}
              onDelete={() => {
                if (!confirm(`Remover "${activeDrink.name || "Sem nome"}"?`)) return;
                onRemoveDrink(activeDrink.id);
              }}
              subheadItems={[
                "Salvo",
                `${activeDrink.items.length} ingrediente${activeDrink.items.length !== 1 ? "s" : ""}`,
              ]}
            />

            {/* Foto 16:10 */}
            <div
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "16 / 10",
                borderRadius: 10,
                overflow: "hidden",
                backgroundColor: "var(--surface-alt)",
                border: "1px solid var(--line)",
                marginBottom: 14,
              }}
            >
              {activeDrink.photoDataUrl ? (
                <img
                  src={activeDrink.photoDataUrl}
                  alt={activeDrink.name}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "linear-gradient(135deg, var(--surface-alt) 0%, var(--line) 100%)",
                  }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 36, color: "var(--muted)", opacity: 0.4 }}>
                    local_bar
                  </span>
                </div>
              )}

              {/* Controls — bottom right */}
              <div
                style={{
                  position: "absolute",
                  bottom: 8,
                  right: 8,
                  display: "flex",
                  gap: 4,
                }}
              >
                <label
                  style={{
                    background: "rgba(255,255,255,0.92)",
                    backdropFilter: "blur(6px)",
                    border: "1px solid rgba(0,0,0,0.05)",
                    fontSize: 11,
                    fontWeight: 500,
                    padding: "5px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Trocar foto
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) await onUploadPhoto(activeDrink.id, f);
                    }}
                  />
                </label>
                {activeDrink.photoDataUrl && (
                  <button
                    onClick={() => onUpdateDrink(activeDrink.id, { photoDataUrl: undefined })}
                    title="Remover foto"
                    style={{
                      background: "rgba(255,255,255,0.92)",
                      backdropFilter: "blur(6px)",
                      border: "1px solid rgba(0,0,0,0.05)",
                      padding: "5px 8px",
                      borderRadius: 6,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: 14, fontVariationSettings: '"FILL" 0, "wght" 500' }}>
                      close
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Toggle: No cardápio público */}
            <button
              onClick={() => onUpdateDrink(activeDrink.id, { showOnPublicMenu: !activeDrink.showOnPublicMenu })}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                backgroundColor: activeDrink.showOnPublicMenu ? "var(--accent-soft)" : "var(--surface-alt)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                color: activeDrink.showOnPublicMenu ? "var(--accent-strong)" : "var(--foreground)",
                fontFamily: "inherit",
                marginBottom: 14,
              }}
            >
              <span>No cardápio público</span>
              <span
                style={{
                  display: "inline-block",
                  width: 28,
                  height: 16,
                  borderRadius: 999,
                  backgroundColor: activeDrink.showOnPublicMenu ? "var(--accent)" : "var(--line)",
                  position: "relative",
                  transition: "background-color 160ms ease",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: activeDrink.showOnPublicMenu ? 14 : 2,
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    backgroundColor: "white",
                    transition: "left 160ms ease",
                  }}
                />
              </span>
            </button>

            {/* Custo ou Precificação */}
            <div style={{ marginBottom: 14 }}>
              {drinksMode === "editor" ? (
                <CostBlock cost={activeCost} />
              ) : (
                <PriceBlock
                  drink={activeDrink}
                  cost={activeCost}
                  settings={settings}
                  onUpdateDrink={onUpdateDrink}
                />
              )}
            </div>

            {/* Receita */}
            <div style={{ marginBottom: 18 }}>
            <RecipeSection
              drink={activeDrink}
              mode={drinksMode}
              ingredients={ingredients}
              ingredientMap={ingredientMap}
              ingredientGroups={ingredientGroups}
              settings={settings}
              onAddItem={() => onAddItemToDrink(activeDrink.id)}
              onUpdateItem={(idx, patch) => onUpdateItem(activeDrink.id, idx, patch)}
              onRemoveItem={(idx) => onRemoveItem(activeDrink.id, idx)}
            />
            </div>

            {/* Preparo — editor only */}
            {drinksMode === "editor" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={sectTitle()}>Preparo</span>
                <textarea
                  style={{
                    width: "100%",
                    minHeight: 72,
                    resize: "vertical",
                    border: "1px solid var(--line)",
                    borderRadius: 7,
                    padding: "9px 11px",
                    background: "var(--background)",
                    fontFamily: "inherit",
                    fontSize: 12,
                    outline: "none",
                    boxSizing: "border-box",
                    lineHeight: 1.5,
                  }}
                  value={activeDrink.preparationNotes ?? ""}
                  placeholder="Modo de preparo, copo, decoração..."
                  onChange={(e) => onUpdateDrink(activeDrink.id, { preparationNotes: e.target.value })}
                />
              </div>
            )}
          </Drawer>
        )}
      </div>
    </div>
  );
}
