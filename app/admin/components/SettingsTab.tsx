"use client";

import React from "react";
import Link from "next/link";
import { clamp } from "@/lib/utils";
import { NumberField } from "@/app/admin/components/NumberField";
import {
  type Settings,
  type Ingredient,
  type Drink,
  DEFAULT_SETTINGS,
  FONT_SCALE,
  pillStyle,
  adminCard,
  adminBtn,
  adminBtnDanger,
  adminInput,
  adminSmall,
} from "@/app/admin/admin-types";
import type { QzConnectionState } from "@/lib/qz-tray";

export type SettingsTabProps = {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  settingsTab: "geral" | "impressao";
  setSettingsTab: (t: "geral" | "impressao") => void;

  // dados para CSV export
  ingredients: Ingredient[];
  drinks: Drink[];

  // reset
  setIngredients: React.Dispatch<React.SetStateAction<Ingredient[]>>;
  setDrinks: React.Dispatch<React.SetStateAction<Drink[]>>;
  setActiveDrinkId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveIngredientId: React.Dispatch<React.SetStateAction<string | null>>;
  setTab: (tab: "receitas" | "drinks" | "ingredients" | "settings") => void;

  // CSV
  csvInputRef: React.RefObject<HTMLInputElement | null>;
  onExportCsv: () => void;
  onTriggerCsvImport: () => void;
  onImportCsvFile: (file: File) => Promise<void>;

  // QZ
  qzConnectionState: QzConnectionState;
  qzPrinterName: string;
  setQzPrinterName: (name: string) => void;
  qzBusy: boolean;
  qzError: string;
  onConnectQz: () => Promise<void>;
  onPrintTest: () => Promise<void>;
};

export function SettingsTab({
  settings,
  setSettings,
  settingsTab,
  setSettingsTab,
  ingredients,
  drinks,
  setIngredients,
  setDrinks,
  setActiveDrinkId,
  setActiveIngredientId,
  setTab,
  csvInputRef,
  onExportCsv,
  onTriggerCsvImport,
  onImportCsvFile,
  qzConnectionState,
  qzPrinterName,
  setQzPrinterName,
  qzBusy,
  qzError,
  onConnectQz,
  onPrintTest,
}: SettingsTabProps) {
  const card = adminCard;
  const btn = adminBtn;
  const btnDanger = adminBtnDanger;
  const input = adminInput;
  const small = adminSmall;

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0, fontSize: FONT_SCALE.lg, marginBottom: 10 }}>Configurações</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button style={pillStyle(settingsTab === "geral")} onClick={() => setSettingsTab("geral")}>Geral</button>
        <button style={pillStyle(settingsTab === "impressao")} onClick={() => setSettingsTab("impressao")}>Impressão</button>
      </div>

      {settingsTab === "geral" && (
        <>
          <div className="settings-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            <div>
              <div style={small}>Markup (x)</div>
              <NumberField
                style={input}
                value={settings.markup}
                decimals={2}
                min={0}
                max={100}
                onCommit={(n) => setSettings((s) => ({ ...s, markup: n }))}
              />
            </div>

            <div>
              <div style={small}>CMV alvo (%)</div>
              <NumberField
                style={input}
                value={Math.round(settings.targetCmv * 100)}
                decimals={0}
                min={1}
                max={100}
                inputMode="numeric"
                onCommit={(n) => setSettings((s) => ({ ...s, targetCmv: clamp(n, 1, 100) / 100 }))}
              />
            </div>

            <div>
              <div style={small}>1 dash = (ml)</div>
              <NumberField
                style={input}
                value={settings.dashMl}
                decimals={2}
                min={0}
                max={10}
                onCommit={(n) => setSettings((s) => ({ ...s, dashMl: n }))}
              />
            </div>

            <div>
              <div style={small}>1 gota = (ml)</div>
              <NumberField
                style={input}
                value={settings.dropMl}
                decimals={2}
                min={0}
                max={1}
                onCommit={(n) => setSettings((s) => ({ ...s, dropMl: n }))}
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ ...small, marginBottom: 6 }}>Exibir preço (cardápio público)</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={pillStyle(settings.publicMenuPriceVisibility === "show")} onClick={() => setSettings((s) => ({ ...s, publicMenuPriceVisibility: "show" }))}>Mostrar</div>
              <div style={pillStyle(settings.publicMenuPriceVisibility === "none")} onClick={() => setSettings((s) => ({ ...s, publicMenuPriceVisibility: "none" }))}>Ocultar</div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={settings.showPublicMenuGarnish}
                onChange={(e) => setSettings((s) => ({ ...s, showPublicMenuGarnish: e.target.checked }))}
              />
              <span style={small}>Exibir ingredientes da categoria Garnish no cardápio público</span>
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ ...small, marginBottom: 6 }}>Visualização do cardápio público</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={pillStyle(settings.publicMenuViewMode === "cards")} onClick={() => setSettings((s) => ({ ...s, publicMenuViewMode: "cards" }))}>Cards</div>
              <div style={pillStyle(settings.publicMenuViewMode === "list")} onClick={() => setSettings((s) => ({ ...s, publicMenuViewMode: "list" }))}>Lista</div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ ...small, marginBottom: 6 }}>Arredondamento psicológico (Resumo e preços)</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={pillStyle(settings.roundingMode === "none")} onClick={() => setSettings((s) => ({ ...s, roundingMode: "none" }))}>Nenhum</div>
              <div style={pillStyle(settings.roundingMode === "end_90")} onClick={() => setSettings((s) => ({ ...s, roundingMode: "end_90" }))}>Terminar em ,90</div>
              <div style={pillStyle(settings.roundingMode === "end_50")} onClick={() => setSettings((s) => ({ ...s, roundingMode: "end_50" }))}>Terminar em ,50</div>
              <div style={pillStyle(settings.roundingMode === "end_00")} onClick={() => setSettings((s) => ({ ...s, roundingMode: "end_00" }))}>Terminar em ,00</div>
            </div>
          </div>

          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "14px 0" }} />

          <button
            style={btnDanger}
            onClick={() => {
              if (confirm("Apagar todos os dados salvos no navegador?")) {
                setIngredients([]);
                setDrinks([]);
                setSettings({ ...DEFAULT_SETTINGS });
                setActiveDrinkId(null);
                setActiveIngredientId(null);
                setTab("receitas");
              }
            }}
          >
            Resetar tudo
          </button>

          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "14px 0" }} />

          <div style={{ display: "grid", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: FONT_SCALE.md }}>Importar e exportar CSV</h3>
            <div style={small}>Seção separada para backup e restauração dos dados.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={btn} onClick={onExportCsv}>
                Exportar CSV
              </button>
              <button style={btn} onClick={onTriggerCsvImport}>
                Importar CSV
              </button>
            </div>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const shouldReplace = confirm("Importar CSV e substituir os dados atuais?");
                if (shouldReplace) await onImportCsvFile(file);
                e.currentTarget.value = "";
              }}
            />
          </div>
        </>
      )}

      {settingsTab === "impressao" && (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ ...small, fontWeight: 700 }}>Preferências de impressão dos pedidos</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: FONT_SCALE.sm,
                fontWeight: 700,
                color: qzConnectionState === "connected" ? "#0f5132" : "#7a3e00",
                background: qzConnectionState === "connected" ? "#d1fae5" : "#fff1c2",
                border: qzConnectionState === "connected" ? "1px solid #86efac" : "1px solid #f6cc5e",
                borderRadius: 999,
                padding: "2px 8px",
              }}
            >
              {qzConnectionState === "connected" ? "QZ conectado nesta janela" : "QZ desconectado nesta janela"}
            </span>
            <div style={small}>A conexão do QZ vale apenas para a aba/janela atual do navegador.</div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <input
              value={qzPrinterName}
              onChange={(e) => setQzPrinterName(e.target.value)}
              placeholder="Nome da impressora no QZ (opcional)"
              style={{ ...btn, minWidth: 280, padding: "6px 10px", fontWeight: 500 }}
            />
            <button style={{ ...btn, padding: "6px 10px" }} onClick={() => void onConnectQz()} disabled={qzBusy}>
              {qzBusy ? "Conectando..." : "Conectar QZ"}
            </button>
            <button style={{ ...btn, padding: "6px 10px" }} onClick={() => void onPrintTest()} disabled={qzBusy}>
              Teste avançado
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <div style={small}>O preset de impressão agora é selecionado por página (ex.: Pedidos).</div>
            <Link href="/admin/impressao" style={{ ...btn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Editar layouts
            </Link>
          </div>
          <div style={small}>Impressão direta ESC/POS com encoding ISO-8859-1.</div>
          {qzError ? <div style={{ ...small, color: "#b00020" }}>{qzError}</div> : null}
        </div>
      )}
    </div>
  );
}
