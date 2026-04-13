"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  applyPsychRounding,
  computeDrinkCost,
  DEFAULT_SETTINGS,
  normalizeDrink,
  normalizeIngredients,
} from "@/app/admin/admin-types";
import type { Drink, Ingredient, Settings } from "@/app/admin/admin-types";
import { internalPageStyle, internalThemeVars } from "@/app/admin/internal-theme";

/* ------------------------------------------------------------------ */
/* Parâmetros editáveis da planilha                                     */
/* ------------------------------------------------------------------ */

type Params = {
  semanas: number;
  noitesSemana: number;
  pessoasNoite: number;
  drinksPessoa: number;
  custoFixo: number;
  funcNoite: number;
  repasse: number;
  consumoValor: number; // valor de face do consumo oferecido (preço de cardápio)
};

const DEFAULT_PARAMS: Params = {
  semanas: 7,
  noitesSemana: 6,
  pessoasNoite: 20,
  drinksPessoa: 2.25,
  custoFixo: 20000,
  funcNoite: 450,
  repasse: 5,
  consumoValor: 0,
};

const PARAMS_STORAGE_KEY = "viabilidade_params_v1";

function loadParams(): Params {
  try {
    const raw = localStorage.getItem(PARAMS_STORAGE_KEY);
    if (!raw) return DEFAULT_PARAMS;
    return { ...DEFAULT_PARAMS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PARAMS;
  }
}

function saveParams(p: Params) {
  try {
    localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(p));
  } catch {}
}

/* ------------------------------------------------------------------ */
/* Helpers de formatação                                                */
/* ------------------------------------------------------------------ */

function brl(v: number): string {
  return "R$\u00a0" + Math.round(v).toLocaleString("pt-BR");
}

function pct(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1) + "%";
}

/* ------------------------------------------------------------------ */
/* Componente principal                                                  */
/* ------------------------------------------------------------------ */

export default function ViabilidadePage() {
  const [loading, setLoading] = useState(true);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);

  /* Busca dados do Supabase */
  useEffect(() => {
    (async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) { setLoading(false); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data } = await supabase
        .from("app_state")
        .select("state")
        .eq("user_id", user.id)
        .maybeSingle();

      if (data?.state) {
        const s = data.state as Record<string, unknown>;
        setIngredients(normalizeIngredients(s.ingredients));
        setDrinks(Array.isArray(s.drinks) ? s.drinks.map(normalizeDrink) : []);
        if (s.settings && typeof s.settings === "object") {
          setSettings({ ...DEFAULT_SETTINGS, ...(s.settings as Partial<Settings>) });
        }
      }
      setLoading(false);
      setParams(loadParams());
    })();
  }, []);

  /* Persiste params no localStorage a cada mudança */
  useEffect(() => {
    saveParams(params);
  }, [params]);

  /* Drinks do cardápio público com custo e preço calculados */
  const drinkRows = useMemo(() => {
    const publicDrinks = drinks.filter((d) => d.showOnPublicMenu);
    return publicDrinks.map((d) => {
      const cost = computeDrinkCost(d, ingredients, settings);
      let price: number;
      if (d.publicMenuPriceMode === "manual") {
        price = d.manualPublicPrice ?? 0;
      } else if (d.publicMenuPriceMode === "cmv") {
        price = applyPsychRounding(cost / settings.targetCmv, settings.roundingMode);
      } else {
        price = applyPsychRounding(cost * settings.markup, settings.roundingMode);
      }
      return { id: d.id, name: d.name, cost, price };
    });
  }, [drinks, ingredients, settings]);

  /* Cálculos financeiros */
  const calc = useMemo(() => {
    const noites = params.semanas * params.noitesSemana;
    const drinksNoite = params.pessoasNoite * params.drinksPessoa;
    const totalDrinks = drinksNoite * noites;
    const avgPrice = drinkRows.length
      ? drinkRows.reduce((s, d) => s + d.price, 0) / drinkRows.length
      : 0;
    const avgCost = drinkRows.length
      ? drinkRows.reduce((s, d) => s + d.cost, 0) / drinkRows.length
      : 0;
    const avgMargin = avgPrice - avgCost;
    const receitaBruta = totalDrinks * avgPrice;
    const custoIngr = totalDrinks * avgCost;
    const custoFunc = params.funcNoite * noites;
    const repasse = receitaBruta * (params.repasse / 100);
    // Consumo: valor de face fornecido em drinks; custo real = proporcional ao CMV médio
    const cmvRatio = avgPrice > 0 ? avgCost / avgPrice : 0;
    const custoConsumo = params.consumoValor * cmvRatio;
    const economiaCusumo = params.consumoValor - custoConsumo;
    const custoTotal = params.custoFixo + custoFunc + custoIngr + repasse + custoConsumo;
    const lucro = receitaBruta - custoTotal;
    const margemLiquida = receitaBruta > 0 ? (lucro / receitaBruta) * 100 : 0;
    const denominador = avgMargin * (1 - params.repasse / 100);
    const bevenNoite =
      denominador > 0
        ? Math.ceil((params.custoFixo + custoFunc + custoConsumo) / denominador / noites)
        : null;
    return { noites, drinksNoite, totalDrinks, avgPrice, avgCost, avgMargin, receitaBruta, custoIngr, custoFunc, repasse, custoConsumo, economiaCusumo, custoTotal, lucro, margemLiquida, bevenNoite };
  }, [params, drinkRows]);

  const maxMargin = useMemo(
    () => Math.max(...drinkRows.map((d) => d.price - d.cost), 1),
    [drinkRows]
  );

  function setParam<K extends keyof Params>(key: K, val: number) {
    setParams((p) => ({ ...p, [key]: val }));
  }

  /* ---- estilos ---- */
  const card: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: "14px 16px",
  };

  const metricCard: React.CSSProperties = {
    ...card,
    background: "var(--panel2)",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--muted)",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    marginBottom: 8,
  };

  const numInputStyle: React.CSSProperties = {
    width: 100,
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "4px 8px",
    fontSize: 13,
    textAlign: "right",
    background: "var(--panel)",
    color: "var(--ink)",
    fontFamily: "inherit",
  };

  const thStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--muted)",
    textAlign: "left",
    padding: "6px 10px",
    borderBottom: "1px solid var(--border)",
    background: "var(--panel2)",
    whiteSpace: "nowrap",
  };

  const tdStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderBottom: "1px solid rgba(0,0,0,0.06)",
    fontSize: 13,
    verticalAlign: "middle",
  };

  if (loading) {
    return (
      <div style={{ ...internalPageStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--muted)", fontSize: 14 }}>Carregando…</span>
      </div>
    );
  }

  const lucroPositivo = calc.lucro >= 0;
  const posColor = "#1D9E75";
  const negColor = "#D85A30";
  const warnColor = "#BA7517";

  return (
    <div style={{ ...internalPageStyle, ...internalThemeVars }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>

        {/* Cabeçalho */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Viabilidade econômica</h1>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            Simulação baseada nos drinks do cardápio público ({drinkRows.length} drinks)
          </p>
        </div>

        {drinkRows.length === 0 && (
          <div style={{ ...card, color: "var(--muted)", fontSize: 13, marginBottom: 24 }}>
            Nenhum drink marcado como "Mostrar no cardápio público". Configure os drinks na aba Custos & Cardápio.
          </div>
        )}

        {/* Métricas principais */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10, marginBottom: 24 }}>
          {[
            {
              label: "Receita bruta",
              value: brl(calc.receitaBruta),
              sub: brl(calc.receitaBruta / calc.noites) + "/noite",
              color: undefined,
            },
            {
              label: "Custo total",
              value: brl(calc.custoTotal),
              sub: brl(calc.custoTotal / calc.noites) + "/noite",
              color: undefined,
            },
            {
              label: lucroPositivo ? "Lucro" : "Prejuízo",
              value: brl(calc.lucro),
              sub: "margem " + pct(calc.margemLiquida),
              color: lucroPositivo ? posColor : negColor,
            },
            {
              label: "Ponto de equilíbrio",
              value: calc.bevenNoite !== null ? calc.bevenNoite + " drinks" : "—",
              sub: "por noite",
              color:
                calc.bevenNoite !== null && calc.bevenNoite <= calc.drinksNoite
                  ? posColor
                  : warnColor,
            },
          ].map((m) => (
            <div key={m.label} style={metricCard}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 5 }}>{m.label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: m.color ?? "var(--ink)" }}>{m.value}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{m.sub}</div>
            </div>
          ))}
        </div>

        {/* Parâmetros */}
        <div style={{ marginBottom: 24 }}>
          <div style={labelStyle}>Parâmetros da operação</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10 }}>
            {/* Operação */}
            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 10 }}>Operação</div>
              {[
                { label: "Semanas de operação", key: "semanas" as const, step: 1, min: 1 },
                { label: "Noites por semana", key: "noitesSemana" as const, step: 1, min: 1 },
                { label: "Pessoas por noite", key: "pessoasNoite" as const, step: 5, min: 1 },
                { label: "Drinks por pessoa", key: "drinksPessoa" as const, step: 0.25, min: 0.25 },
              ].map(({ label, key, step, min }) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <label style={{ fontSize: 13, color: "var(--muted)", flex: 1 }}>{label}</label>
                  <input
                    type="number"
                    value={params[key]}
                    min={min}
                    step={step}
                    style={numInputStyle}
                    onChange={(e) => setParam(key, parseFloat(e.target.value) || 0)}
                  />
                </div>
              ))}
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                → <strong style={{ color: "var(--ink)" }}>{Math.round(calc.drinksNoite)}</strong> drinks/noite
              </div>
            </div>

            {/* Custos */}
            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 10 }}>Custos fixos e variáveis</div>
              {[
                { label: "Custo fixo total (R$)", key: "custoFixo" as const, step: 500 },
                { label: "Funcionários por noite (R$)", key: "funcNoite" as const, step: 50 },
                { label: "Repasse contratual (%)", key: "repasse" as const, step: 0.5 },
                { label: "Consumo no bar — valor de face (R$)", key: "consumoValor" as const, step: 500 },
              ].map(({ label, key, step }) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <label style={{ fontSize: 13, color: "var(--muted)", flex: 1 }}>{label}</label>
                  <input
                    type="number"
                    value={params[key]}
                    min={0}
                    step={step}
                    style={numInputStyle}
                    onChange={(e) => setParam(key, parseFloat(e.target.value) || 0)}
                  />
                </div>
              ))}
              {params.consumoValor > 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  → custo real ao bar:{" "}
                  <strong style={{ color: posColor }}>{brl(calc.custoConsumo)}</strong>
                  {" "}(economia de {brl(calc.economiaCusumo)} vs. valor de face)
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tabela de drinks */}
        <div style={{ marginBottom: 24 }}>
          <div style={labelStyle}>Drinks do cardápio público</div>
          <div style={card}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "38%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "14%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={thStyle}>Drink</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Preço (R$)</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Custo (R$)</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Margem (R$)</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Contribuição</th>
                  </tr>
                </thead>
                <tbody>
                  {drinkRows.map((d) => {
                    const margin = d.price - d.cost;
                    const barPct = Math.round((margin / maxMargin) * 100);
                    return (
                      <tr key={d.id}>
                        <td style={tdStyle}>{d.name}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{brl(d.price)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{brl(d.cost)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: margin > 0 ? posColor : negColor }}>
                          {brl(margin)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ flex: 1, height: 5, background: "var(--border)", borderRadius: 3 }}>
                              <div
                                style={{
                                  width: barPct + "%",
                                  height: 5,
                                  background: posColor,
                                  borderRadius: 3,
                                }}
                              />
                            </div>
                            <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 30, textAlign: "right" }}>
                              {barPct}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {drinkRows.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ ...tdStyle, color: "var(--muted)", textAlign: "center", padding: "20px 10px" }}>
                        Nenhum drink no cardápio público
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Médias */}
            {drinkRows.length > 0 && (
              <div style={{ display: "flex", gap: 16, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
                {[
                  { label: "Preço médio", value: brl(calc.avgPrice) },
                  { label: "Custo médio", value: brl(calc.avgCost) },
                  { label: "Margem média", value: brl(calc.avgMargin), highlight: true },
                  { label: "CMV médio", value: pct(calc.avgPrice > 0 ? (calc.avgCost / calc.avgPrice) * 100 : 0) },
                ].map((m) => (
                  <div key={m.label} style={{ fontSize: 12 }}>
                    <span style={{ color: "var(--muted)" }}>{m.label}: </span>
                    <span style={{ fontWeight: 600, color: m.highlight ? posColor : "var(--ink)" }}>{m.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Resumo financeiro */}
        <div style={{ marginBottom: 24 }}>
          <div style={labelStyle}>Resumo financeiro — operação completa</div>
          <div style={card}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {[
                  { label: "Total de noites", value: calc.noites },
                  { label: "Total de drinks vendidos", value: calc.totalDrinks.toLocaleString("pt-BR") },
                  { label: "Preço médio por drink", value: brl(calc.avgPrice) },
                  { label: "Custo médio por drink", value: brl(calc.avgCost) },
                  { label: "Margem média por drink", value: brl(calc.avgMargin), highlight: posColor },
                ].map(({ label, value, highlight }) => (
                  <tr key={label}>
                    <td style={{ ...tdStyle, color: "var(--muted)" }}>{label}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: highlight ? 600 : undefined, color: highlight ?? "var(--ink)" }}>
                      {value}
                    </td>
                  </tr>
                ))}

                {/* Separador */}
                <tr><td colSpan={2} style={{ padding: "4px 0" }} /></tr>

                {[
                  { label: `(-) Custo fixo operacional`, value: brl(params.custoFixo) },
                  { label: `(-) Funcionários (${calc.noites} noites × ${brl(params.funcNoite)})`, value: brl(calc.custoFunc) },
                  { label: `(-) Ingredientes`, value: brl(calc.custoIngr) },
                  { label: `(-) Repasse contratual (${pct(params.repasse)})`, value: brl(calc.repasse) },
                  ...(params.consumoValor > 0 ? [{
                    label: `(-) Consumo no bar (custo real de ${brl(params.consumoValor)} em valor de face)`,
                    value: brl(calc.custoConsumo),
                  }] : []),
                ].map(({ label, value }) => (
                  <tr key={label}>
                    <td style={{ ...tdStyle, color: "var(--muted)" }}>{label}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{value}</td>
                  </tr>
                ))}

                {/* Total */}
                <tr style={{ borderTop: "1.5px solid var(--border)" }}>
                  <td style={{ ...tdStyle, fontWeight: 700, fontSize: 14, paddingTop: 10 }}>
                    {lucroPositivo ? "Lucro" : "Prejuízo"} líquido
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontSize: 14, paddingTop: 10, color: lucroPositivo ? posColor : negColor }}>
                    {brl(calc.lucro)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
