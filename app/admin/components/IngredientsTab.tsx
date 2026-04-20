"use client";

import React, { useMemo, useState } from "react";
import { formatBRL } from "@/lib/utils";
import { NumberField } from "@/app/admin/components/NumberField";
import { Drawer } from "@/app/admin/components/Drawer";
import { DrawerHeader } from "@/app/admin/components/DrawerHeader";
import { SegmentedControl } from "@/app/admin/components/SegmentedControl";
import {
  type Drink,
  type Ingredient,
  type IngredientCategory,
  type PricingModel,
  type Settings,
  INGREDIENT_CATEGORIES,
  INGREDIENT_CATEGORY_LABEL,
  computeCostPerMl,
  computeItemCost,
} from "@/app/admin/admin-types";

/* ─── tipos ──────────────────────────────────────────────────────────── */

export type IngredientsTabProps = {
  ingredients: Ingredient[];
  drinks: Drink[];
  settings: Settings;
  activeIngredientId: string | null;
  activeIngredient: Ingredient | null;
  setActiveIngredientId: (id: string | null) => void;
  onAddIngredient: (category?: IngredientCategory) => void;
  onUpdateIngredient: (id: string, patch: Partial<Ingredient>) => void;
  onDuplicateIngredient: (id: string) => void;
  onRemoveIngredient: (id: string) => void;
  onNavigateToDrink: (drinkId: string) => void;
};

/* ─── helpers ────────────────────────────────────────────────────────── */

function sectTitle(): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--muted)",
    margin: 0,
    display: "block",
    marginBottom: 10,
  };
}

function mono(size = 13): React.CSSProperties {
  return {
    fontFamily: "var(--font-app-mono), monospace",
    fontSize: size,
    fontWeight: 500,
  };
}

const fieldInput: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 7,
  border: "1px solid var(--line)",
  background: "var(--background)",
  fontFamily: "inherit",
  fontSize: 13,
  color: "var(--foreground)",
  outline: "none",
  boxSizing: "border-box",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <label style={{ fontSize: 11, fontWeight: 500, color: "var(--muted)" }}>{label}</label>
      {children}
    </div>
  );
}

/* ─── CalcHero ───────────────────────────────────────────────────────── */

function CalcHero({ ingredient }: { ingredient: Ingredient }) {
  const cpm = computeCostPerMl(ingredient);
  const hasValue = cpm !== null && cpm > 0;

  let formulaLine = "";
  if (ingredient.pricingModel === "by_bottle" && ingredient.bottlePrice && ingredient.bottleMl) {
    const yieldMl = ingredient.yieldMl ?? ingredient.bottleMl;
    const lossPct = ingredient.lossPct ?? 0;
    const effectiveYield = yieldMl * (1 - lossPct / 100);
    formulaLine = `${ingredient.bottlePrice.toFixed(2)} ÷ (${effectiveYield.toFixed(0)}${lossPct > 0 ? ` × ${((100 - lossPct) / 100).toFixed(2)}` : ""})`;
  } else if (ingredient.pricingModel === "by_ml" && ingredient.costPerMl) {
    formulaLine = `${formatBRL(ingredient.costPerMl)} / ml (direto)`;
  }

  return (
    <div
      style={{
        position: "relative",
        background: hasValue ? "var(--accent-soft)" : "var(--surface-alt)",
        color: hasValue ? "var(--accent-strong)" : "var(--muted)",
        border: `1px solid ${hasValue ? "color-mix(in srgb, var(--accent) 25%, transparent)" : "var(--line)"}`,
        borderRadius: 10,
        padding: "18px 16px 14px",
        textAlign: "center",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 10,
          left: 14,
          fontSize: 10,
          fontWeight: 700,
          opacity: 0.6,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        Custo/ml
      </span>

      <span>
        <span
          style={{
            ...mono(ingredient.pricingModel === "by_unit" ? 20 : hasValue ? 32 : 22),
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {ingredient.pricingModel === "by_unit"
            ? "N/A"
            : hasValue
            ? `${formatBRL(cpm!)}`
            : "Sem preço"}
        </span>
        {hasValue && ingredient.pricingModel !== "by_unit" && (
          <span style={{ fontSize: 14, opacity: 0.65, marginLeft: 2, fontWeight: 500 }}>/ml</span>
        )}
      </span>

      {formulaLine && (
        <span
          style={{
            display: "block",
            ...mono(11),
            opacity: 0.55,
            marginTop: 8,
          }}
        >
          {formulaLine}
        </span>
      )}
    </div>
  );
}

/* ─── ImpactSection ──────────────────────────────────────────────────── */

function ImpactSection({
  ingredient,
  drinks,
  settings,
  onNavigateToDrink,
}: {
  ingredient: Ingredient;
  drinks: Drink[];
  settings: Settings;
  onNavigateToDrink: (drinkId: string) => void;
}) {
  const impactRows = useMemo(() => {
    return drinks
      .flatMap((d) => {
        const item = d.items.find((it) => it.ingredientId === ingredient.id);
        if (!item) return [];
        const cost = computeItemCost(item, ingredient, settings);
        return [{ drink: d, cost }];
      })
      .sort((a, b) => b.cost - a.cost);
  }, [drinks, ingredient, settings]);

  if (impactRows.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 20 }}>
      <span style={sectTitle()}>Impacto nos drinks</span>
      <div
        style={{
          background: "var(--background)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          padding: "6px 14px",
        }}
      >
        {impactRows.map(({ drink, cost }, idx) => (
          <button
            key={drink.id}
            onClick={() => onNavigateToDrink(drink.id)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: idx === 0 ? "2px 0 7px" : "7px 0",
              border: "none",
              borderTop: idx === 0 ? "none" : "1px dashed var(--line)",
              fontSize: 13,
              width: "100%",
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
              fontFamily: "inherit",
            }}
          >
            <span style={{ color: "var(--foreground)" }}>{drink.name || "Sem nome"}</span>
            <span style={{ ...mono(13), color: "var(--muted)" }}>{formatBRL(cost)} / drink</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── IngredientForm ─────────────────────────────────────────────────── */

function IngredientForm({
  ingredient,
  onUpdate,
}: {
  ingredient: Ingredient;
  onUpdate: (patch: Partial<Ingredient>) => void;
}) {
  const model = ingredient.pricingModel;

  if (model === "by_bottle") {
    return (
      <>
        {/* Compra */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 20 }}>
          <span style={sectTitle()}>Compra</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Preço (R$)">
              <NumberField
                style={fieldInput}
                value={ingredient.bottlePrice ?? 0}
                decimals={2}
                min={0}
                onCommit={(n) => onUpdate({ bottlePrice: n })}
              />
            </Field>
            <Field label="ml nominal">
              <NumberField
                style={fieldInput}
                value={ingredient.bottleMl ?? 0}
                decimals={0}
                min={0}
                inputMode="numeric"
                onCommit={(n) => onUpdate({ bottleMl: n })}
              />
            </Field>
          </div>
        </div>

        {/* Rendimento */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 20 }}>
          <span style={sectTitle()}>Rendimento real</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="yield (ml)">
              <NumberField
                style={fieldInput}
                value={ingredient.yieldMl ?? (ingredient.bottleMl ?? 0)}
                decimals={0}
                min={0}
                inputMode="numeric"
                onCommit={(n) => onUpdate({ yieldMl: n })}
              />
            </Field>
            <Field label="perdas (%)">
              <NumberField
                style={fieldInput}
                value={ingredient.lossPct ?? 0}
                decimals={0}
                min={0}
                max={100}
                inputMode="numeric"
                onCommit={(n) => onUpdate({ lossPct: n })}
              />
            </Field>
          </div>
        </div>
      </>
    );
  }

  if (model === "by_ml") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 20 }}>
        <span style={sectTitle()}>Compra</span>
        <Field label="Custo direto (R$/ml)">
          <NumberField
            style={fieldInput}
            value={ingredient.costPerMl ?? 0}
            decimals={4}
            min={0}
            onCommit={(n) => onUpdate({ costPerMl: n })}
          />
        </Field>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 20 }}>
      <span style={sectTitle()}>Compra</span>
      <Field label="Custo por unidade (R$)">
        <NumberField
          style={fieldInput}
          value={ingredient.costPerUnit ?? 0}
          decimals={2}
          min={0}
          onCommit={(n) => onUpdate({ costPerUnit: n })}
        />
      </Field>
    </div>
  );
}

/* ─── IngredientsTab ─────────────────────────────────────────────────── */

export function IngredientsTab({
  ingredients,
  drinks,
  settings,
  activeIngredientId,
  activeIngredient,
  setActiveIngredientId,
  onAddIngredient,
  onUpdateIngredient,
  onDuplicateIngredient,
  onRemoveIngredient,
  onNavigateToDrink,
}: IngredientsTabProps) {
  const [search, setSearch] = useState("");
  const [activeCategories, setActiveCategories] = useState<Set<IngredientCategory>>(new Set());

  const toggleCategory = (cat: IngredientCategory) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const filteredIngredients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ingredients.filter((i) => {
      if (activeCategories.size > 0 && !activeCategories.has(i.category)) return false;
      if (q && !i.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [ingredients, search, activeCategories]);

  const groupedIngredients = useMemo(() => {
    return INGREDIENT_CATEGORIES.map((cat) => ({
      category: cat,
      items: filteredIngredients.filter((i) => i.category === cat),
    })).filter((g) => g.items.length > 0);
  }, [filteredIngredients]);

  const categoriesWithIngredients = useMemo(
    () => INGREDIENT_CATEGORIES.filter((cat) => ingredients.some((i) => i.category === cat)),
    [ingredients],
  );

  const drinkUsageByIngredient = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of drinks) {
      for (const it of d.items) {
        map.set(it.ingredientId, (map.get(it.ingredientId) ?? 0) + 1);
      }
    }
    return map;
  }, [drinks]);

  const drinkUsageCount = useMemo(() => {
    if (!activeIngredient) return 0;
    return drinks.filter((d) => d.items.some((it) => it.ingredientId === activeIngredient.id)).length;
  }, [drinks, activeIngredient]);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "16px 24px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <h2 style={{ margin: "0 8px 0 0", fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
          Ingredientes
        </h2>

        {/* Category filters */}
        <button
          onClick={() => setActiveCategories(new Set())}
          style={{
            padding: "6px 12px",
            borderRadius: 999,
            border: `1px solid ${activeCategories.size === 0 ? "var(--accent-soft)" : "var(--line)"}`,
            backgroundColor: activeCategories.size === 0 ? "var(--accent-soft)" : "transparent",
            color: activeCategories.size === 0 ? "var(--accent-strong)" : "var(--muted)",
            fontWeight: activeCategories.size === 0 ? 600 : 500,
            fontSize: 12,
            cursor: "pointer",
            whiteSpace: "nowrap",
            fontFamily: "inherit",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          Todos{" "}
          <span style={{ opacity: 0.6 }}>{ingredients.length}</span>
        </button>

        {categoriesWithIngredients.map((cat) => {
          const active = activeCategories.has(cat);
          const count = ingredients.filter((i) => i.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: `1px solid ${active ? "var(--accent-soft)" : "var(--line)"}`,
                backgroundColor: active ? "var(--accent-soft)" : "transparent",
                color: active ? "var(--accent-strong)" : "var(--muted)",
                fontWeight: active ? 600 : 500,
                fontSize: 12,
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontFamily: "inherit",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {INGREDIENT_CATEGORY_LABEL[cat]}{" "}
              <span style={{ opacity: 0.6 }}>{count}</span>
            </button>
          );
        })}

        {/* Novo ingrediente — pill-add */}
        <button
          onClick={() => {
            const firstActive = activeCategories.size > 0 ? [...activeCategories][0] : undefined;
            onAddIngredient(firstActive);
          }}
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
          Novo
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
            placeholder="Buscar..."
            style={{
              width: 220,
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

      {/* Split */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 520px",
          minHeight: "calc(100vh - 200px)",
          alignItems: "start",
        }}
      >
        {/* Table */}
        <div
          style={{
            overflowY: "auto",
            height: "calc(100vh - 220px)",
            background: "var(--background)",
          }}
        >
          {groupedIngredients.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 13,
                border: "1px dashed var(--line)",
                borderRadius: 8,
                margin: "8px 0",
              }}
            >
              {search || activeCategories.size > 0
                ? "Nenhum ingrediente encontrado."
                : 'Sem ingredientes. Clique em "Novo" para adicionar.'}
            </div>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr>
                  {["Nome", "Categoria", "Modelo", "R$/ml", "Usado em"].map((col, i) => (
                    <th
                      key={col}
                      style={{
                        position: "sticky",
                        top: 0,
                        background: "var(--surface-alt)",
                        borderBottom: "1px solid var(--line)",
                        padding: "10px 16px",
                        textAlign: i >= 3 ? "right" : "left",
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        zIndex: 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupedIngredients.map((group) => (
                  <React.Fragment key={group.category}>
                    <tr>
                      <td
                        colSpan={5}
                        style={{
                          background: "var(--background)",
                          borderTop: "1px solid var(--line)",
                          borderBottom: 0,
                          padding: "16px 16px 6px",
                          fontSize: 10,
                          fontWeight: 700,
                          color: "var(--muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                        }}
                      >
                        {INGREDIENT_CATEGORY_LABEL[group.category]}
                      </td>
                    </tr>
                    {group.items.map((ing) => {
                      const cpm = computeCostPerMl(ing);
                      const active = ing.id === activeIngredientId;
                      const usedIn = drinkUsageByIngredient.get(ing.id) ?? 0;

                      const modelLabel =
                        ing.pricingModel === "by_bottle" && ing.bottlePrice && ing.bottleMl
                          ? `R$ ${ing.bottlePrice.toFixed(2)} / ${ing.bottleMl}ml`
                          : ing.pricingModel === "by_ml"
                          ? "R$/ml direto"
                          : ing.pricingModel === "by_unit"
                          ? "por unidade"
                          : "—";

                      const costDisplay =
                        ing.pricingModel === "by_unit"
                          ? ing.costPerUnit != null && ing.costPerUnit > 0
                            ? `${formatBRL(ing.costPerUnit)}/un`
                            : null
                          : cpm != null && cpm > 0
                          ? `${formatBRL(cpm)}`
                          : null;

                      return (
                        <tr
                          key={ing.id}
                          onClick={() => setActiveIngredientId(ing.id)}
                          style={{
                            borderBottom: "1px solid var(--line)",
                            cursor: "pointer",
                            background: active ? "var(--accent-soft)" : undefined,
                            transition: "background 80ms ease",
                          }}
                          onMouseEnter={(e) => {
                            if (!active) (e.currentTarget as HTMLTableRowElement).style.background = "var(--surface)";
                          }}
                          onMouseLeave={(e) => {
                            if (!active) (e.currentTarget as HTMLTableRowElement).style.background = "";
                          }}
                        >
                          <td
                            style={{
                              padding: "12px 16px",
                              fontWeight: active ? 600 : 500,
                              color: active ? "var(--accent-strong)" : "var(--foreground)",
                            }}
                          >
                            {ing.name || "Sem nome"}
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                borderRadius: 4,
                                background: "var(--surface-btn)",
                                color: "var(--muted)",
                                fontSize: 11,
                                fontWeight: 500,
                              }}
                            >
                              {INGREDIENT_CATEGORY_LABEL[ing.category]}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", ...mono(11), color: "var(--muted)" }}>
                            {modelLabel}
                          </td>
                          <td
                            style={{
                              padding: "12px 16px",
                              textAlign: "right",
                              ...mono(12),
                              color: costDisplay ? "var(--foreground)" : "var(--terracota)",
                            }}
                          >
                            {costDisplay ?? "sem preço"}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right", color: "var(--muted)", fontSize: 13 }}>
                            {usedIn > 0 ? usedIn : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Drawer */}
        {activeIngredient ? (
          <Drawer width={520}>
            <DrawerHeader
              breadcrumb={INGREDIENT_CATEGORY_LABEL[activeIngredient.category]}
              activeLabel={activeIngredient.name || "Sem nome"}
              name={activeIngredient.name}
              onNameChange={(v) => onUpdateIngredient(activeIngredient.id, { name: v })}
              onDuplicate={() => onDuplicateIngredient(activeIngredient.id)}
              onDelete={() => {
                if (!confirm(`Remover "${activeIngredient.name || "Sem nome"}"?`)) return;
                onRemoveIngredient(activeIngredient.id);
              }}
              subheadItems={[
                "Salvo",
                drinkUsageCount > 0
                  ? `Usado em ${drinkUsageCount} drink${drinkUsageCount !== 1 ? "s" : ""}`
                  : "Não usado em drinks",
              ]}
              size="lg"
            />

            {/* Cálculo */}
            <div style={{ marginBottom: 20 }}>
              <CalcHero ingredient={activeIngredient} />
            </div>

            {/* Classificação */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
              <span style={sectTitle()}>Classificação</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Categoria">
                  <select
                    style={fieldInput}
                    value={activeIngredient.category}
                    onChange={(e) =>
                      onUpdateIngredient(activeIngredient.id, { category: e.target.value as IngredientCategory })
                    }
                  >
                    {INGREDIENT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{INGREDIENT_CATEGORY_LABEL[cat]}</option>
                    ))}
                  </select>
                </Field>
                <div />
              </div>
              <Field label="Modelo de precificação">
                <SegmentedControl
                  options={[
                    { value: "by_bottle", label: "Por garrafa" },
                    { value: "by_ml", label: "R$/ml" },
                    { value: "by_unit", label: "Por unidade" },
                  ]}
                  value={activeIngredient.pricingModel}
                  onChange={(v) => onUpdateIngredient(activeIngredient.id, { pricingModel: v as PricingModel })}
                />
              </Field>
            </div>

            {/* Formulário condicional */}
            <IngredientForm
              ingredient={activeIngredient}
              onUpdate={(patch) => onUpdateIngredient(activeIngredient.id, patch)}
            />

            {/* Impacto */}
            <ImpactSection
              ingredient={activeIngredient}
              drinks={drinks}
              settings={settings}
              onNavigateToDrink={onNavigateToDrink}
            />

            {/* Notas */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={sectTitle()}>Notas</span>
              <textarea
                style={{
                  ...fieldInput,
                  minHeight: 60,
                  resize: "vertical",
                  lineHeight: 1.5,
                }}
                value={activeIngredient.notes ?? ""}
                placeholder="Observações sobre este ingrediente..."
                onChange={(e) => onUpdateIngredient(activeIngredient.id, { notes: e.target.value })}
              />
            </div>
          </Drawer>
        ) : (
          <div
            style={{
              borderLeft: "1px solid var(--line)",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--muted)",
              fontSize: 13,
              background: "var(--surface)",
            }}
          >
            Selecione um ingrediente para editar
          </div>
        )}
      </div>
    </div>
  );
}
