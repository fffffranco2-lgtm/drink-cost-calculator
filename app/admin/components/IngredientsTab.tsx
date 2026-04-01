"use client";

import React from "react";
import { formatBRL } from "@/lib/utils";
import { NumberField } from "@/app/admin/components/NumberField";
import { ScrollShadow } from "@/app/admin/components/ScrollShadow";
import {
  type Ingredient,
  type IngredientCategory,
  type PricingModel,
  INGREDIENT_CATEGORIES,
  INGREDIENT_CATEGORY_LABEL,
  computeCostPerMl,
  FONT_SCALE,
  adminCard,
  adminBtn,
  adminIconBtn,
  adminIconBtnDanger,
  adminInput,
  adminSmall,
  adminCategoryButtonStyle,
  adminIngredientButtonStyle,
} from "@/app/admin/admin-types";

export type IngredientsTabProps = {
  ingredients: Ingredient[];
  activeIngredientId: string | null;
  activeIngredient: Ingredient | null;
  activeCategoryIngredients: Ingredient[];
  ingredientCategoryTab: IngredientCategory;
  setIngredientCategoryTab: (c: IngredientCategory) => void;
  setActiveIngredientId: React.Dispatch<React.SetStateAction<string | null>>;
  onAddIngredient: () => void;
  onUpdateIngredient: (id: string, patch: Partial<Ingredient>) => void;
  onDuplicateIngredient: (id: string) => void;
  onRemoveIngredient: (id: string) => void;
};

export function IngredientsTab({
  ingredients,
  activeIngredientId,
  activeIngredient,
  activeCategoryIngredients,
  ingredientCategoryTab,
  setIngredientCategoryTab,
  setActiveIngredientId,
  onAddIngredient,
  onUpdateIngredient,
  onDuplicateIngredient,
  onRemoveIngredient,
}: IngredientsTabProps) {
  const card = adminCard;
  const iconBtn = adminIconBtn;
  const iconBtnDanger = adminIconBtnDanger;
  const input = adminInput;
  const small = adminSmall;
  const categoryButtonStyle = adminCategoryButtonStyle;
  const ingredientButtonStyle = adminIngredientButtonStyle;

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ marginTop: 0, fontSize: FONT_SCALE.lg, marginBottom: 10 }}>Ingredientes</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={small}>{ingredients.length} ingrediente(s)</div>
        </div>
      </div>

      <ScrollShadow axis="x" style={{ display: "flex", gap: 8, paddingBottom: 6, marginBottom: 10 }}>
        {INGREDIENT_CATEGORIES.map((category) => {
          const count = ingredients.filter((i) => i.category === category).length;
          return (
            <div
              key={category}
              style={categoryButtonStyle(category === ingredientCategoryTab)}
              onClick={() => setIngredientCategoryTab(category)}
            >
              {INGREDIENT_CATEGORY_LABEL[category]} ({count})
            </div>
          );
        })}
      </ScrollShadow>

      {ingredients.length === 0 ? (
        <div style={{ padding: 14, borderWidth: 1, borderStyle: "dashed", borderColor: "var(--border)", borderRadius: 14, color: "var(--muted)" }}>
          Sem ingredientes. Clique no "+" para criar.
        </div>
      ) : (
        <>
          <ScrollShadow axis="x" style={{ display: "flex", gap: 8, paddingBottom: 6, marginBottom: 10 }}>
            <div
              style={{ ...ingredientButtonStyle(false), display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              onClick={onAddIngredient}
              aria-label="Adicionar ingrediente"
            >
              <span className="material-symbols-rounded" style={{ fontSize: 16 }} aria-hidden>add</span>
            </div>
            {activeCategoryIngredients.map((i) => (
              <div key={i.id} style={ingredientButtonStyle(i.id === activeIngredientId)} onClick={() => setActiveIngredientId(i.id)}>
                {i.name || "Sem nome"}
              </div>
            ))}
            {activeCategoryIngredients.length === 0 && (
              <div style={{ ...small, padding: "8px 2px" }}>
                Nenhum ingrediente nesta categoria.
              </div>
            )}
          </ScrollShadow>

          {activeIngredient && activeIngredient.category === ingredientCategoryTab && (
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
              {/* Nome */}
              <input
                style={{ ...input, marginBottom: 16, fontSize: FONT_SCALE.md, fontWeight: 600 }}
                value={activeIngredient.name}
                onChange={(e) => onUpdateIngredient(activeIngredient.id, { name: e.target.value })}
                placeholder="Nome do ingrediente"
              />

              {/* Categoria + Modelo de Precificação */}
              <div className="ingredient-config-grid" style={{
                background: "white",
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: "var(--border)",
                borderRadius: 14,
                padding: 14,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 16,
              }}>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: FONT_SCALE.sm, fontWeight: 600, color: "var(--muted)" }}>Categoria</label>
                  <select
                    style={input}
                    value={activeIngredient.category}
                    onChange={(e) => {
                      const nextCategory = e.target.value as IngredientCategory;
                      setIngredientCategoryTab(nextCategory);
                      onUpdateIngredient(activeIngredient.id, { category: nextCategory });
                    }}
                  >
                    {INGREDIENT_CATEGORIES.map((category) => (
                      <option key={category} value={category}>{INGREDIENT_CATEGORY_LABEL[category]}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: FONT_SCALE.sm, fontWeight: 600, color: "var(--muted)" }}>Modelo de Precificação</label>
                  <select
                    style={input}
                    value={activeIngredient.pricingModel}
                    onChange={(e) => onUpdateIngredient(activeIngredient.id, { pricingModel: e.target.value as PricingModel })}
                  >
                    <option value="by_bottle">Por garrafa (R$ + ml + yield)</option>
                    <option value="by_ml">Direto R$/ml</option>
                    <option value="by_unit">Por unidade</option>
                  </select>
                </div>
              </div>

              {/* Preço - Por Garrafa */}
              {activeIngredient.pricingModel === "by_bottle" && (
                <div style={{ background: "white", borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", borderRadius: 14, padding: 14, marginBottom: 16 }}>
                  <h3 style={{ margin: "0 0 12px 0", fontSize: FONT_SCALE.md, fontWeight: 700 }}>Preços (Garrafa)</h3>
                  <div className="ingredient-bottle-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={{ display: "block", marginBottom: 6, fontSize: FONT_SCALE.sm, fontWeight: 600, color: "var(--muted)" }}>Preço (R$)</label>
                      <NumberField
                        style={input}
                        value={activeIngredient.bottlePrice ?? 0}
                        decimals={2}
                        min={0}
                        onCommit={(n) => onUpdateIngredient(activeIngredient.id, { bottlePrice: n })}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", marginBottom: 6, fontSize: FONT_SCALE.sm, fontWeight: 600, color: "var(--muted)" }}>ml nominal</label>
                      <NumberField
                        style={input}
                        value={activeIngredient.bottleMl ?? 0}
                        decimals={0}
                        min={0}
                        inputMode="numeric"
                        onCommit={(n) => onUpdateIngredient(activeIngredient.id, { bottleMl: n })}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", marginBottom: 6, fontSize: FONT_SCALE.sm, fontWeight: 600, color: "var(--muted)" }}>yield real (ml)</label>
                      <NumberField
                        style={input}
                        value={activeIngredient.yieldMl ?? (activeIngredient.bottleMl ?? 0)}
                        decimals={0}
                        min={0}
                        inputMode="numeric"
                        onCommit={(n) => onUpdateIngredient(activeIngredient.id, { yieldMl: n })}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", marginBottom: 6, fontSize: FONT_SCALE.sm, fontWeight: 600, color: "var(--muted)" }}>perdas (%)</label>
                      <NumberField
                        style={input}
                        value={activeIngredient.lossPct ?? 0}
                        decimals={0}
                        min={0}
                        max={100}
                        inputMode="numeric"
                        onCommit={(n) => onUpdateIngredient(activeIngredient.id, { lossPct: n })}
                      />
                    </div>
                  </div>

                  <div style={{ background: "#f9f9f9", borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", borderRadius: 10, padding: 12 }}>
                    <div style={small}>R$/ml calculado</div>
                    <div style={{ fontSize: FONT_SCALE.md, fontWeight: 700, color: "var(--ink)" }}>{formatBRL(computeCostPerMl(activeIngredient) ?? 0)} / ml</div>
                  </div>
                </div>
              )}

              {/* Preço - Direto R$/ml */}
              {activeIngredient.pricingModel === "by_ml" && (
                <div style={{ background: "white", borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", borderRadius: 14, padding: 14, marginBottom: 16 }}>
                  <h3 style={{ margin: "0 0 12px 0", fontSize: FONT_SCALE.md, fontWeight: 700 }}>Preço (R$/ml)</h3>
                  <div className="ingredient-two-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", marginBottom: 6, fontSize: FONT_SCALE.sm, fontWeight: 600, color: "var(--muted)" }}>R$/ml</label>
                      <NumberField
                        style={input}
                        value={activeIngredient.costPerMl ?? 0}
                        decimals={2}
                        min={0}
                        onCommit={(n) => onUpdateIngredient(activeIngredient.id, { costPerMl: n })}
                      />
                    </div>
                    <div style={{ background: "#f9f9f9", borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", borderRadius: 10, padding: 12 }}>
                      <div style={small}>Calculado</div>
                      <div style={{ fontSize: FONT_SCALE.md, fontWeight: 700, color: "var(--ink)" }}>{formatBRL(computeCostPerMl(activeIngredient) ?? 0)} / ml</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Preço - Por Unidade */}
              {activeIngredient.pricingModel === "by_unit" && (
                <div style={{ background: "white", borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", borderRadius: 14, padding: 14, marginBottom: 16 }}>
                  <h3 style={{ margin: "0 0 12px 0", fontSize: FONT_SCALE.md, fontWeight: 700 }}>Preço (Por Unidade)</h3>
                  <div className="ingredient-two-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", marginBottom: 6, fontSize: FONT_SCALE.sm, fontWeight: 600, color: "var(--muted)" }}>R$ por unidade</label>
                      <NumberField
                        style={input}
                        value={activeIngredient.costPerUnit ?? 0}
                        decimals={2}
                        min={0}
                        onCommit={(n) => onUpdateIngredient(activeIngredient.id, { costPerUnit: n })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Notas */}
              <div style={{ background: "white", borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", borderRadius: 14, padding: 14, marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 8, fontSize: FONT_SCALE.md, fontWeight: 600, color: "var(--ink)" }}>Notas (opcional)</label>
                <textarea
                  style={{ ...input, minHeight: 70, padding: 10, fontSize: FONT_SCALE.sm, fontFamily: "inherit" }}
                  value={activeIngredient.notes ?? ""}
                  placeholder="Adicione notas sobre este ingrediente..."
                  onChange={(e) => onUpdateIngredient(activeIngredient.id, { notes: e.target.value })}
                />
              </div>

              {/* Ações */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  style={iconBtn}
                  onClick={() => onDuplicateIngredient(activeIngredient.id)}
                  aria-label="Duplicar ingrediente"
                  title="Duplicar ingrediente"
                >
                  <span className="material-symbols-rounded" aria-hidden>content_copy</span>
                </button>
                <button
                  style={iconBtnDanger}
                  onClick={() => {
                    const shouldRemove = confirm(`Remover o ingrediente "${activeIngredient.name || "Sem nome"}"?`);
                    if (!shouldRemove) return;
                    onRemoveIngredient(activeIngredient.id);
                  }}
                  aria-label="Remover ingrediente"
                  title="Remover ingrediente"
                >
                  <span className="material-symbols-rounded" aria-hidden>delete</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
