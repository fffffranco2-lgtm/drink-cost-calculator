"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  internalButtonStyle,
  internalCardStyle,
  internalDangerButtonStyle,
  internalFocusStyle,
  internalHeaderCardStyle,
  internalInputStyle,
  internalPageStyle,
  internalSmallTextStyle,
} from "@/app/admin/internal-theme";

type TableConfig = {
  id: string;
  name: string;
  code: string;
  link: string;
  qrCodeUrl: string;
  createdAt: string;
  updatedAt: string;
};

type TablesResponse = {
  tables?: TableConfig[];
  error?: string;
};

export default function AdminTablesPage() {
  const [tables, setTables] = useState<TableConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [createName, setCreateName] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [draftById, setDraftById] = useState<Record<string, { name: string; code: string }>>({});

  const loadTables = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/admin/api/mesas", { cache: "no-store" });
      const payload = (await res.json()) as TablesResponse;
      if (!res.ok) {
        setError(payload.error ?? "Falha ao carregar mesas.");
        return;
      }

      const nextTables = Array.isArray(payload.tables) ? payload.tables : [];
      setTables(nextTables);
      setDraftById((prev) => {
        const next: Record<string, { name: string; code: string }> = {};
        for (const table of nextTables) {
          const old = prev[table.id];
          next[table.id] = {
            name: old?.name ?? table.name,
            code: old?.code ?? table.code,
          };
        }
        return next;
      });
    } catch {
      setError("Erro de rede ao carregar mesas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  const updateDraft = (tableId: string, patch: Partial<{ name: string; code: string }>) => {
    setDraftById((prev) => ({
      ...prev,
      [tableId]: {
        name: patch.name ?? prev[tableId]?.name ?? "",
        code: patch.code ?? prev[tableId]?.code ?? "",
      },
    }));
  };

  const createTable = async () => {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/admin/api/mesas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName,
          code: createCode || undefined,
        }),
      });
      const payload = (await res.json()) as { table?: TableConfig; error?: string };
      if (!res.ok || !payload.table) {
        setError(payload.error ?? "Falha ao criar mesa.");
        return;
      }
      const createdTable = payload.table;

      setTables((prev) => [...prev, createdTable]);
      setDraftById((prev) => ({
        ...prev,
        [createdTable.id]: { name: createdTable.name, code: createdTable.code },
      }));
      setCreateName("");
      setCreateCode("");
    } catch {
      setError("Erro de rede ao criar mesa.");
    } finally {
      setCreating(false);
    }
  };

  const saveTable = async (tableId: string) => {
    if (savingId) return;
    const draft = draftById[tableId];
    if (!draft) return;

    setSavingId(tableId);
    setError("");
    try {
      const res = await fetch(`/admin/api/mesas/${tableId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name, code: draft.code }),
      });
      const payload = (await res.json()) as { table?: TableConfig; error?: string };

      if (!res.ok || !payload.table) {
        setError(payload.error ?? "Falha ao salvar mesa.");
        return;
      }
      const updatedTable = payload.table;

      setTables((prev) => prev.map((table) => (table.id === tableId ? updatedTable : table)));
      setDraftById((prev) => ({
        ...prev,
        [tableId]: { name: updatedTable.name, code: updatedTable.code },
      }));
    } catch {
      setError("Erro de rede ao salvar mesa.");
    } finally {
      setSavingId(null);
    }
  };

  const removeTable = async (table: TableConfig) => {
    if (deletingId) return;
    const confirmed = window.confirm(`Remover a mesa \"${table.name}\"?`);
    if (!confirmed) return;

    setDeletingId(table.id);
    setError("");
    try {
      const res = await fetch(`/admin/api/mesas/${table.id}`, {
        method: "DELETE",
      });
      const payload = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !payload.ok) {
        setError(payload.error ?? "Falha ao remover mesa.");
        return;
      }

      setTables((prev) => prev.filter((item) => item.id !== table.id));
      setDraftById((prev) => {
        const next = { ...prev };
        delete next[table.id];
        return next;
      });
    } catch {
      setError("Erro de rede ao remover mesa.");
    } finally {
      setDeletingId(null);
    }
  };

  const copyLink = async (table: TableConfig) => {
    try {
      await navigator.clipboard.writeText(table.link);
      setCopiedId(table.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === table.id ? null : current));
      }, 1300);
    } catch {
      setError("Não foi possível copiar o link da mesa.");
    }
  };

  const isDirtyById = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const table of tables) {
      const draft = draftById[table.id];
      map[table.id] = Boolean(draft && (draft.name !== table.name || draft.code !== table.code));
    }
    return map;
  }, [draftById, tables]);

  const page: React.CSSProperties = { ...internalPageStyle };
  const container: React.CSSProperties = { maxWidth: 1180, margin: "0 auto" };
  const card: React.CSSProperties = { ...internalCardStyle };
  const headerCard: React.CSSProperties = { ...internalHeaderCardStyle };
  const small: React.CSSProperties = { ...internalSmallTextStyle };
  const input: React.CSSProperties = { ...internalInputStyle };
  const btn: React.CSSProperties = {
    ...internalButtonStyle,
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
  };

  const responsiveStyle = `
    @media (max-width: 980px) {
      .tables-create-grid,
      .tables-row-grid,
      .tables-name-code-grid {
        grid-template-columns: 1fr !important;
      }
      .tables-qr-wrap {
        max-width: 280px;
        margin: 0 auto;
        width: 100%;
      }
    }
  `;

  return (
    <div style={page}>
      <style>{`${internalFocusStyle}\n${responsiveStyle}`}</style>
      <div style={container}>
        <div style={{ ...headerCard, marginBottom: 12, position: "relative", paddingRight: 64 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 20 }}>Configuração de Mesas</h1>
              <div style={small}>Crie, renomeie e remova mesas com link e QR code para pedido.</div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href="/admin/pedidos" style={btn}>Pedidos</Link>
              <Link href="/admin" style={btn}>Área interna</Link>
            </div>
          </div>

          {error ? (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: "1px solid var(--dangerBorder)", background: "var(--danger)", color: "#7b1f1f", fontSize: 12 }}>
              {error}
            </div>
          ) : null}

          <button
            style={{
              ...btn,
              position: "absolute",
              right: 16,
              bottom: 16,
              width: 40,
              height: 40,
              borderRadius: 999,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
            onClick={() => void loadTables()}
            disabled={loading || creating || Boolean(savingId) || Boolean(deletingId)}
            aria-label={loading ? "Atualizando mesas" : "Atualizar mesas"}
            title={loading ? "Atualizando..." : "Atualizar"}
          >
            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 20, lineHeight: 1 }}>
              {loading ? "autorenew" : "refresh"}
            </span>
          </button>
        </div>

        <div style={{ ...card, marginBottom: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Nova mesa</h2>
          <div className="tables-create-grid" style={{ display: "grid", gridTemplateColumns: "1.1fr 0.8fr auto", gap: 10, alignItems: "end" }}>
            <div>
              <div style={{ ...small, marginBottom: 4 }}>Nome da mesa</div>
              <input
                style={input}
                placeholder="Ex.: Mesa varanda"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                maxLength={80}
              />
            </div>
            <div>
              <div style={{ ...small, marginBottom: 4 }}>Código (opcional)</div>
              <input
                style={input}
                placeholder="Ex.: VARANDA"
                value={createCode}
                onChange={(event) => setCreateCode(event.target.value)}
                maxLength={20}
              />
            </div>
            <button
              style={{ ...btn, height: 40, minWidth: 130, background: "var(--pillActive)" }}
              onClick={() => void createTable()}
              disabled={creating || !createName.trim()}
            >
              {creating ? "Criando..." : "Criar mesa"}
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {tables.length === 0 ? (
            <div style={{ ...card, color: "var(--muted)" }}>Nenhuma mesa cadastrada.</div>
          ) : (
            tables.map((table) => {
              const draft = draftById[table.id] ?? { name: table.name, code: table.code };
              return (
                <div key={table.id} className="tables-row-grid" style={{ ...card, display: "grid", gridTemplateColumns: "1fr 260px", gap: 12, alignItems: "start" }}>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="tables-name-code-grid" style={{ display: "grid", gridTemplateColumns: "1fr 0.7fr", gap: 10 }}>
                      <div>
                        <div style={{ ...small, marginBottom: 4 }}>Nome</div>
                        <input
                          style={input}
                          value={draft.name}
                          onChange={(event) => updateDraft(table.id, { name: event.target.value })}
                          maxLength={80}
                        />
                      </div>
                      <div>
                        <div style={{ ...small, marginBottom: 4 }}>Código</div>
                        <input
                          style={input}
                          value={draft.code}
                          onChange={(event) => updateDraft(table.id, { code: event.target.value })}
                          maxLength={20}
                        />
                      </div>
                    </div>

                    <div>
                      <div style={{ ...small, marginBottom: 4 }}>Link público</div>
                      <div style={{ ...input, wordBreak: "break-all", fontSize: 12 }}>{table.link}</div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        style={{ ...btn, background: "var(--pillActive)" }}
                        disabled={!isDirtyById[table.id] || savingId === table.id || Boolean(deletingId)}
                        onClick={() => void saveTable(table.id)}
                      >
                        {savingId === table.id ? "Salvando..." : "Salvar"}
                      </button>
                      <button
                        style={btn}
                        onClick={() => void copyLink(table)}
                        disabled={Boolean(savingId) || Boolean(deletingId)}
                      >
                        {copiedId === table.id ? "Copiado" : "Copiar link"}
                      </button>
                      <a href={table.link} target="_blank" rel="noreferrer" style={btn}>Abrir link</a>
                      <button
                        style={{ ...btn, ...internalDangerButtonStyle }}
                        disabled={deletingId === table.id || Boolean(savingId)}
                        onClick={() => void removeTable(table)}
                      >
                        {deletingId === table.id ? "Removendo..." : "Remover"}
                      </button>
                    </div>
                  </div>

                  <div className="tables-qr-wrap" style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 8, background: "white", position: "relative" }}>
                    <img
                      src={table.qrCodeUrl}
                      alt={`QR code da mesa ${table.name}`}
                      style={{ width: "100%", height: "auto", display: "block", borderRadius: 8 }}
                    />
                    <a
                      href={`/admin/api/mesas/${table.id}/qrcode`}
                      title="Baixar QR"
                      aria-label="Baixar QR"
                      style={{
                        position: "absolute",
                        right: 14,
                        bottom: 34,
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "rgba(255,255,255,0.96)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--ink)",
                        textDecoration: "none",
                        boxShadow: "0 6px 14px rgba(0,0,0,0.12)",
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M12 4V14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M8.5 10.5L12 14L15.5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M5 18H19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </a>
                    <div style={{ ...small, marginTop: 6, textAlign: "center" }}>QR da mesa {table.code}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
