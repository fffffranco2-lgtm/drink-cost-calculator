"use client";

import React from "react";
import { formatBRL } from "@/lib/utils";
import { NumberField } from "@/app/admin/components/NumberField";
import { ScrollShadow } from "@/app/admin/components/ScrollShadow";
import {
  type Drink,
  type Ingredient,
  type RecipeItem,
  type RecipeUnit,
  type Settings,
  INGREDIENT_CATEGORY_LABEL,
  applyPsychRounding,
  computeCostPerMl,
  FONT_SCALE,
  pillStyle,
  adminCard,
  adminBtn,
  adminBtnDanger,
  adminIconBtn,
  adminIconBtnDanger,
  adminInput,
  adminSmall,
} from "@/app/admin/admin-types";

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
  onAddDrink: () => void;
  onUpdateDrink: (id: string, patch: Partial<Drink>) => void;
  onRemoveDrink: (id: string) => void;
  onDuplicateDrink: (id: string) => void;
  onAddItemToDrink: (drinkId: string) => void;
  onUpdateItem: (drinkId: string, idx: number, patch: Partial<RecipeItem>) => void;
  onRemoveItem: (drinkId: string, idx: number) => void;
  onUploadPhoto: (drinkId: string, file: File) => Promise<void>;
};

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
  onAddDrink,
  onUpdateDrink,
  onRemoveDrink,
  onDuplicateDrink,
  onAddItemToDrink,
  onUpdateItem,
  onRemoveItem,
  onUploadPhoto,
}: DrinksTabProps) {
  const card = adminCard;
  const btn = adminBtn;
  const btnDanger = adminBtnDanger;
  const iconBtn = adminIconBtn;
  const iconBtnDanger = adminIconBtnDanger;
  const input = adminInput;
  const small = adminSmall;

  return (
    <div style={card}>
      {/* Header: título + contagem + ação */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ marginTop: 0, fontSize: FONT_SCALE.lg, fontWeight: 700, marginBottom: 10 }}>Drinks</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={small}>{drinks.length} drink{drinks.length !== 1 ? "s" : ""}</div>
          <button style={btn} onClick={onAddDrink}>+ Drink</button>
        </div>
      </div>

      {drinks.length === 0 ? (
        <div style={{ padding: 20, borderWidth: 1, borderStyle: "dashed", borderColor: "var(--border)", borderRadius: 16, color: "var(--muted)", textAlign: "center" }}>
          <div style={{ fontSize: FONT_SCALE.md, marginBottom: 8 }}>Sem drinks</div>
          <div style={{ fontSize: FONT_SCALE.sm }}>Clique em "+ Drink" para começar</div>
        </div>
      ) : (
        <>
          {/* Lista de drinks */}
          <ScrollShadow axis="x" style={{ display: "flex", gap: 10, paddingBottom: 8, marginBottom: 16, overflowX: "auto" }}>
            {drinks.map((d) => (
              <div
                key={d.id}
                style={{
                  ...pillStyle(d.id === activeDrinkId),
                  padding: "10px 14px",
                  fontSize: FONT_SCALE.md,
                  fontWeight: 600,
                  transition: "all 0.2s ease",
                  cursor: "pointer",
                }}
                onClick={() => setActiveDrinkId(d.id)}
              >
                {d.name || "Sem nome"}
              </div>
            ))}
          </ScrollShadow>

          {activeDrink && (
            <div style={{
              backgroundColor: "var(--panel2)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: "var(--border)",
              borderRadius: 18,
              padding: 20,
              maxWidth: 900,
              margin: "0 auto",
            }}>
              {/* Nome do drink */}
              <input
                style={{ ...input, marginBottom: 16, fontSize: FONT_SCALE.md, fontWeight: 600 }}
                value={activeDrink.name}
                onChange={(e) => onUpdateDrink(activeDrink.id, { name: e.target.value })}
                placeholder="Nome do drink"
              />

              {/* Foto + Controles */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr",
                gap: 16,
                alignItems: "start",
                marginBottom: 20,
                paddingBottom: 20,
                borderBottomWidth: 1,
                borderBottomStyle: "solid",
                borderBottomColor: "var(--border)",
              }}>
                {/* Foto */}
                <div style={{
                  width: 120,
                  height: 120,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: "var(--border)",
                  background: "white",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--muted)",
                  fontSize: FONT_SCALE.sm,
                  boxShadow: "0 4px 12px rgba(32, 37, 42, 0.06)",
                  flexShrink: 0,
                }}>
                  {activeDrink.photoDataUrl ? (
                    <img
                      src={activeDrink.photoDataUrl}
                      alt="Foto do drink"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <span style={{ textAlign: "center", lineHeight: 1.5, fontSize: FONT_SCALE.sm }}>Sem foto</span>
                  )}
                </div>

                {/* Controles de foto */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <label style={{ ...btn, display: "inline-block", cursor: "pointer", textAlign: "center", padding: "8px 10px", fontSize: FONT_SCALE.sm }}>
                    Inserir foto
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        await onUploadPhoto(activeDrink.id, f);
                      }}
                    />
                  </label>

                  <button
                    style={{ ...btnDanger, opacity: !activeDrink.photoDataUrl ? 0.5 : 1, padding: "8px 10px", fontSize: FONT_SCALE.sm }}
                    disabled={!activeDrink.photoDataUrl}
                    onClick={() => {
                      if (!activeDrink.photoDataUrl) return;
                      if (!confirm("Remover a foto deste drink?")) return;
                      onUpdateDrink(activeDrink.id, { photoDataUrl: undefined });
                    }}
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

                const kpiCard = (label: string, value: string, subtitle?: string) => (
                  <div style={{
                    borderWidth: 1,
                    borderStyle: "solid",
                    borderColor: "var(--border)",
                    borderRadius: 12,
                    padding: 12,
                    background: "white",
                    boxShadow: "0 2px 6px rgba(32, 37, 42, 0.03)",
                  }}>
                    <div style={{ ...small, marginBottom: 6, fontWeight: 500 }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", marginBottom: subtitle ? 4 : 0 }}>{value}</div>
                    {subtitle && <div style={{ ...small }}>{subtitle}</div>}
                  </div>
                );

                return (
                  <div className="kpi-grid" style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 10,
                    marginBottom: 20,
                  }}>
                    {kpiCard("Custo", formatBRL(cost))}
                    {kpiCard(
                      "Preço (Markup)",
                      formatBRL(markupP),
                      `${settings.markup}x • ${settings.roundingMode === "none" ? "sem arred." : "arred."}`
                    )}
                    {kpiCard(
                      "Preço (CMV)",
                      formatBRL(cmvP),
                      `${Math.round(settings.targetCmv * 100)}% • ${settings.roundingMode === "none" ? "sem arred." : "arred."}`
                    )}
                  </div>
                );
              })()}

              {/* Receita */}
              <div style={{ background: "white", borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", borderRadius: 14, padding: 14, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: FONT_SCALE.md, fontWeight: 700 }}>Receita ({activeDrink.items.length})</h3>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={{ ...btn, padding: "6px 10px", fontSize: FONT_SCALE.sm }} onClick={() => onAddItemToDrink(activeDrink.id)} disabled={!ingredients.length}>+ Item</button>
                    <button
                      style={{ ...iconBtn, width: 32, height: 32 }}
                      onClick={() => onDuplicateDrink(activeDrink.id)}
                      aria-label="Duplicar drink"
                      title="Duplicar drink"
                    >
                      <span className="material-symbols-rounded" aria-hidden>content_copy</span>
                    </button>
                    <button
                      style={{ ...iconBtnDanger, width: 32, height: 32 }}
                      onClick={() => {
                        const shouldRemove = confirm(`Remover o drink "${activeDrink.name || "Sem nome"}"?`);
                        if (!shouldRemove) return;
                        onRemoveDrink(activeDrink.id);
                      }}
                      aria-label="Remover drink"
                      title="Remover drink"
                    >
                      <span className="material-symbols-rounded" aria-hidden>delete</span>
                    </button>
                  </div>
                </div>

                {activeDrink.items.length === 0 ? (
                  <div style={{ padding: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "var(--border)", borderRadius: 10, color: "var(--muted)", textAlign: "center", fontSize: FONT_SCALE.sm }}>
                    Nenhum item. Clique em "+ Item".
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {activeDrink.items.map((it, idx) => {
                      const ing = ingredientMap.get(it.ingredientId);
                      const cpm = ing ? computeCostPerMl(ing) : null;
                      const perUnit = ing?.pricingModel === "by_unit" ? (ing.costPerUnit ?? 0) : 0;
                      const categoryLabel = ing ? INGREDIENT_CATEGORY_LABEL[ing.category] : "Sem categoria";
                      const unitHint = it.unit === "un" ? `${formatBRL(perUnit)} / un` : `${formatBRL(cpm ?? 0)} / ml`;

                      return (
                        <div
                          className="recipe-item-row"
                          key={`${activeDrink.id}_${idx}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1.5fr 0.6fr 0.6fr 1fr 0.4fr",
                            gap: 8,
                            alignItems: "center",
                            padding: 10,
                            borderWidth: 1,
                            borderStyle: "solid",
                            borderColor: "var(--border)",
                            borderRadius: 10,
                            backgroundColor: "var(--panel)",
                          }}
                        >
                          <select
                            style={{ ...input, padding: "8px", fontSize: FONT_SCALE.sm, background: "white" }}
                            value={it.ingredientId}
                            onChange={(e) => onUpdateItem(activeDrink.id, idx, { ingredientId: e.target.value })}
                          >
                            {ingredientGroups.map((group) => (
                              <optgroup key={group.category} label={INGREDIENT_CATEGORY_LABEL[group.category]}>
                                {group.items.map((i) => (
                                  <option key={i.id} value={i.id}>
                                    {i.name}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>

                          <NumberField
                            style={{ ...input, padding: "8px", fontSize: FONT_SCALE.sm, textAlign: "center", background: "white" }}
                            value={it.qty}
                            decimals={it.unit === "ml" ? 0 : 2}
                            min={0}
                            onCommit={(n) => onUpdateItem(activeDrink.id, idx, { qty: n })}
                          />

                          <select
                            style={{ ...input, padding: "8px", fontSize: FONT_SCALE.sm, background: "white" }}
                            value={it.unit}
                            onChange={(e) => onUpdateItem(activeDrink.id, idx, { unit: e.target.value as RecipeUnit })}
                          >
                            <option value="ml">ml</option>
                            <option value="dash">dash</option>
                            <option value="drop">gota</option>
                            <option value="un">un</option>
                          </select>

                          <div style={{ fontSize: FONT_SCALE.sm, textAlign: "right", lineHeight: 1.3 }}>
                            <div style={{ fontWeight: 500, color: "var(--ink)" }}>{categoryLabel}</div>
                            <div style={{ color: "var(--muted)" }}>{unitHint}</div>
                          </div>

                          <button
                            style={{ ...btnDanger, padding: "6px", fontSize: FONT_SCALE.sm, height: 28, width: 28, minWidth: 28 }}
                            onClick={() => onRemoveItem(activeDrink.id, idx)}
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Notas */}
              <div style={{ background: "white", borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", borderRadius: 14, padding: 14 }}>
                <label style={{ display: "block", marginBottom: 8, fontSize: FONT_SCALE.md, fontWeight: 600, color: "var(--ink)" }}>
                  Notas (opcional)
                </label>
                <textarea
                  style={{ ...input, minHeight: 70, padding: 10, fontSize: FONT_SCALE.sm, fontFamily: "inherit" }}
                  value={activeDrink.notes ?? ""}
                  placeholder="Adicione notas sobre o drink..."
                  onChange={(e) => onUpdateDrink(activeDrink.id, { notes: e.target.value })}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
