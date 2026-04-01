"use client";

import React from "react";
import { formatBRL } from "@/lib/utils";
import { NumberField } from "@/app/admin/components/NumberField";
import {
  type Drink,
  type Settings,
  type CartaViewMode,
  type RecipeSortMode,
  FONT_SCALE,
  pillStyle,
  compactPillStyle,
  adminCard,
  adminInput,
  adminSmall,
} from "@/app/admin/admin-types";

export type CartaRow = {
  d: Drink;
  cost: number;
  prices: { label: string; value: number }[];
  publicPrice: number;
  ingredientLines: string[];
  nameWidthCh: number;
};

export type ResumoTabProps = {
  settings: Settings;
  cartaViewMode: CartaViewMode;
  setCartaViewMode: (m: CartaViewMode) => void;
  menuSearch: string;
  setMenuSearch: (s: string) => void;
  recipeSortMode: RecipeSortMode;
  setRecipeSortMode: (m: RecipeSortMode) => void;
  cartaRows: CartaRow[];
  updateDrink: (id: string, patch: Partial<Drink>) => void;
};

export function ResumoTab({
  settings,
  cartaViewMode,
  setCartaViewMode,
  menuSearch,
  setMenuSearch,
  recipeSortMode,
  setRecipeSortMode,
  cartaRows,
  updateDrink,
}: ResumoTabProps) {
  const card = adminCard;
  const input = adminInput;
  const small = adminSmall;

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ marginTop: 0, fontSize: FONT_SCALE.lg, marginBottom: 10 }}>Resumo</h2>
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={small}>Visualização do Resumo</div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={pillStyle(cartaViewMode === "cards")} onClick={() => setCartaViewMode("cards")}>
              Cards
            </div>
            <div style={pillStyle(cartaViewMode === "list")} onClick={() => setCartaViewMode("list")}>
              Lista
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label htmlFor="recipe-sort" style={small}>Ordenar por</label>
          <select
            id="recipe-sort"
            style={{ ...input, width: "auto", minWidth: 240, padding: "10px 12px" }}
            value={recipeSortMode}
            onChange={(e) => setRecipeSortMode(e.target.value as RecipeSortMode)}
          >
            <option value="alpha_asc">Alfabética (A-Z)</option>
            <option value="alpha_desc">Alfabética (Z-A)</option>
            <option value="price_asc">Preço (menor-maior)</option>
            <option value="price_desc">Preço (maior-menor)</option>
            <option value="cost_asc">Custo (menor-maior)</option>
            <option value="cost_desc">Custo (maior-menor)</option>
          </select>
        </div>
      </div>

      <div
        style={
          cartaViewMode === "cards"
            ? { marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }
            : { marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }
        }
      >
        {cartaRows.map(({ d, prices, publicPrice, ingredientLines, nameWidthCh }) =>
          cartaViewMode === "cards" ? (
            <div
              key={d.id}
              style={{
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: "var(--border)",
                borderRadius: 14,
                background: "white",
                overflow: "hidden",
              }}
            >
              {d.photoDataUrl ? (
                <div
                  style={{
                    height: 120,
                    borderBottomWidth: 1,
                    borderBottomStyle: "solid",
                    borderBottomColor: "var(--border)",
                  }}
                >
                  <img src={d.photoDataUrl} alt={d.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              ) : null}

              <div style={{ padding: 8 }}>
                <div style={{ fontSize: FONT_SCALE.md, fontWeight: 700, lineHeight: 1.15 }}>{d.name}</div>
                {d.notes ? <div style={{ ...small, marginTop: 3, fontSize: FONT_SCALE.sm }}>{d.notes}</div> : null}
                <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, fontSize: FONT_SCALE.sm }}>
                  <input
                    type="checkbox"
                    checked={Boolean(d.showOnPublicMenu)}
                    onChange={(e) => updateDrink(d.id, { showOnPublicMenu: e.target.checked })}
                  />
                  Exibir no cardápio público
                </label>

                <div style={{ marginTop: 8 }}>
                  <div style={{ ...small, fontSize: FONT_SCALE.sm }}>Preço no cardápio público</div>
                  <div
                    style={{
                      marginTop: 4,
                      display: "grid",
                      gridTemplateColumns: d.publicMenuPriceMode === "manual" ? "1fr 1fr 1fr 58px" : "1fr 1fr 1fr",
                      gap: 4,
                      alignItems: "center",
                    }}
                  >
                    <div style={compactPillStyle((d.publicMenuPriceMode ?? "markup") === "markup")} onClick={() => updateDrink(d.id, { publicMenuPriceMode: "markup" })}>
                      Markup
                    </div>
                    <div style={compactPillStyle(d.publicMenuPriceMode === "cmv")} onClick={() => updateDrink(d.id, { publicMenuPriceMode: "cmv" })}>
                      CMV
                    </div>
                    <div style={compactPillStyle(d.publicMenuPriceMode === "manual")} onClick={() => updateDrink(d.id, { publicMenuPriceMode: "manual" })}>
                      Manual
                    </div>
                    {d.publicMenuPriceMode === "manual" ? (
                      <NumberField
                        style={{ ...input, width: 58, padding: "4px 6px", fontSize: FONT_SCALE.sm, borderRadius: 999, textAlign: "center" }}
                        value={d.manualPublicPrice ?? 0}
                        decimals={2}
                        min={0}
                        onCommit={(n) => updateDrink(d.id, { manualPublicPrice: n })}
                      />
                    ) : null}
                  </div>
                  <div style={{ ...small, marginTop: 4, fontSize: FONT_SCALE.sm }}>
                    Preço selecionado: {formatBRL(publicPrice)}
                  </div>
                </div>

                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  {prices.map((p) => (
                    <div key={p.label} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ ...small, fontSize: FONT_SCALE.sm }}>{p.label}</div>
                      <div style={{ fontSize: FONT_SCALE.md, fontWeight: 650 }}>{formatBRL(p.value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div key={d.id} style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", borderRadius: 14, padding: 9, background: "white" }}>
              <div
                className="recipe-list-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1.1fr 0.9fr",
                  gap: 10,
                  alignItems: "start",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    textAlign: "center",
                    height: "100%",
                  }}
                >
                  <div style={{ fontSize: FONT_SCALE.lg, fontWeight: 800, lineHeight: 1.1, display: "inline-block", maxWidth: "100%", width: `${nameWidthCh}ch` }}>
                    {d.name}
                  </div>
                  <div
                    style={{
                      ...small,
                      fontSize: FONT_SCALE.sm,
                      marginTop: 4,
                      color: "#7a8793",
                      display: "inline-block",
                      maxWidth: "100%",
                      width: `min(${nameWidthCh * 2}ch, 100%)`,
                    }}
                  >
                    {ingredientLines.length ? ingredientLines.join(" • ") : "Sem ingredientes"}
                  </div>
                  {d.notes ? <div style={{ ...small, fontSize: FONT_SCALE.sm }}>{d.notes}</div> : null}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    textAlign: "center",
                    height: "100%",
                  }}
                >
                  <div style={{ ...small, fontSize: FONT_SCALE.sm }}>Preço no cardápio público</div>
                  <div
                    style={{
                      marginTop: 4,
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr 58px",
                      gap: 4,
                      alignItems: "center",
                      width: "100%",
                      maxWidth: 260,
                    }}
                  >
                    <div style={compactPillStyle((d.publicMenuPriceMode ?? "markup") === "markup")} onClick={() => updateDrink(d.id, { publicMenuPriceMode: "markup" })}>
                      Markup
                    </div>
                    <div style={compactPillStyle(d.publicMenuPriceMode === "cmv")} onClick={() => updateDrink(d.id, { publicMenuPriceMode: "cmv" })}>
                      CMV
                    </div>
                    <div style={compactPillStyle(d.publicMenuPriceMode === "manual")} onClick={() => updateDrink(d.id, { publicMenuPriceMode: "manual" })}>
                      Manual
                    </div>
                    <NumberField
                      style={{ ...input, width: 58, padding: "4px 6px", fontSize: FONT_SCALE.sm, borderRadius: 999, textAlign: "center" }}
                      value={d.manualPublicPrice ?? 0}
                      decimals={2}
                      min={0}
                      onCommit={(n) => updateDrink(d.id, { manualPublicPrice: n })}
                    />
                  </div>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", marginTop: 6, fontSize: FONT_SCALE.sm }}>
                    <input
                      type="checkbox"
                      checked={Boolean(d.showOnPublicMenu)}
                      onChange={(e) => updateDrink(d.id, { showOnPublicMenu: e.target.checked })}
                    />
                    Exibir no cardápio público
                  </label>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {prices.map((p) => (
                    <div key={p.label} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ ...small, fontSize: FONT_SCALE.sm }}>{p.label}</div>
                      <div style={{ fontSize: FONT_SCALE.md, fontWeight: 650 }}>{formatBRL(p.value)}</div>
                    </div>
                  ))}
                  <div
                    style={{
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderColor: "var(--border)",
                      borderRadius: 10,
                      padding: "7px 8px",
                      backgroundColor: "var(--panel2)",
                    }}
                  >
                    <div style={{ ...small, fontSize: FONT_SCALE.sm }}>Selecionado</div>
                    <div style={{ fontSize: FONT_SCALE.md, fontWeight: 700 }}>{formatBRL(publicPrice)}</div>
                  </div>
                </div>
              </div>
            </div>
          )
        )}

        {cartaRows.length === 0 && (
          <div style={{ padding: 14, borderWidth: 1, borderStyle: "dashed", borderColor: "var(--border)", borderRadius: 14, color: "var(--muted)" }}>
            Nenhum drink encontrado.
          </div>
        )}
      </div>
    </div>
  );
}
