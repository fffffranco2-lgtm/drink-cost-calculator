"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";
import { AdminHeader } from "@/app/components/AdminHeader";

type SessionHistoryRow = {
  id: string;
  code: string;
  openedAt: string;
  closedAt: string | null;
  isOpen: boolean;
  ordersCount: number;
  subtotal: number;
};

type SessionOrder = {
  id: string;
  code: string;
  status: "pendente" | "em_progresso" | "concluido";
  source: "mesa_qr" | "balcao";
  tableCode: string | null;
  subtotal: number;
  createdAt: string;
};

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function OrdersHistoryPage() {
  const [sessions, setSessions] = useState<SessionHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [ordersBySession, setOrdersBySession] = useState<Record<string, SessionOrder[]>>({});
  const [loadingSessionOrders, setLoadingSessionOrders] = useState<Record<string, boolean>>({});

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/orders/sessions", { cache: "no-store" });
      const payload = (await res.json()) as { sessions?: SessionHistoryRow[]; error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Falha ao carregar histórico.");
        return;
      }
      setSessions(Array.isArray(payload.sessions) ? payload.sessions : []);
    } catch {
      setError("Erro de rede ao carregar histórico.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSessionOrders = useCallback(async (sessionId: string) => {
    if (ordersBySession[sessionId] || loadingSessionOrders[sessionId]) return;

    setLoadingSessionOrders((prev) => ({ ...prev, [sessionId]: true }));
    try {
      const res = await fetch(`/api/orders/sessions/${sessionId}/orders`, { cache: "no-store" });
      const payload = (await res.json()) as { orders?: SessionOrder[]; error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Falha ao carregar pedidos da sessão.");
        return;
      }
      setOrdersBySession((prev) => ({ ...prev, [sessionId]: Array.isArray(payload.orders) ? payload.orders : [] }));
    } catch {
      setError("Erro de rede ao carregar pedidos da sessão.");
    } finally {
      setLoadingSessionOrders((prev) => ({ ...prev, [sessionId]: false }));
    }
  }, [loadingSessionOrders, ordersBySession]);

  const toggleSession = useCallback((sessionId: string) => {
    setExpanded((prev) => {
      const nextOpen = !prev[sessionId];
      if (nextOpen) {
        void loadSessionOrders(sessionId);
      }
      return { ...prev, [sessionId]: nextOpen };
    });
  }, [loadSessionOrders]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const page: React.CSSProperties = {
    ["--bg" as never]: "#f6f8fa",
    ["--panel" as never]: "#ffffff",
    ["--ink" as never]: "#141414",
    ["--muted" as never]: "#67707a",
    ["--border" as never]: "#d8dee5",
    background: "var(--bg)",
    minHeight: "100vh",
    color: "var(--ink)",
    padding: 20,
    fontFamily: 'var(--font-app-sans), "Trebuchet MS", "Segoe UI", sans-serif',
  };

  const container: React.CSSProperties = { maxWidth: 1100, margin: "0 auto" };
  const card: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: 14,
  };
  const small: React.CSSProperties = { fontSize: 14, color: "var(--muted)" };
  const btn: React.CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "white",
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 700,
    color: "var(--ink)",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
  };
  const tinyBtn: React.CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "white",
    padding: "4px 8px",
    cursor: "pointer",
    fontWeight: 700,
    color: "var(--ink)",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    fontSize: 14,
  };

  return (
    <div style={page}>
      <div style={container}>
        <AdminHeader
          title="Histórico de Pedidos"
          subtitle="Visualização em árvore de sessões e pedidos"
          currentPage="historico"
          actions={
            <button style={btn} onClick={() => void loadHistory()} disabled={loading}>
              {loading ? "Atualizando..." : "Atualizar"}
            </button>
          }
        />

        {error ? <div style={{ marginBottom: 12, ...small, color: "#b00020", padding: 10, borderRadius: 10, border: "1px solid #f0c2c2", background: "#fff1f1" }}>{error}</div> : null}

        <div style={{ ...card, fontFamily: 'var(--font-app-mono), "JetBrains Mono", "SFMono-Regular", Menlo, monospace' }}>
          {sessions.length === 0 ? (
            <div style={small}>Sem sessões de histórico.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {sessions.map((session) => {
                const isOpen = Boolean(expanded[session.id]);
                const sessionOrders = ordersBySession[session.id] ?? [];
                const isLoadingOrders = Boolean(loadingSessionOrders[session.id]);
                return (
                  <div key={session.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 10, background: "white" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <button
                        onClick={() => toggleSession(session.id)}
                        style={{
                          flex: 1,
                          minWidth: 260,
                          border: 0,
                          background: "transparent",
                          textAlign: "left",
                          padding: 0,
                          cursor: "pointer",
                          color: "var(--ink)",
                          fontFamily: "inherit",
                          fontSize: 14,
                        }}
                      >
                        {isOpen ? "[-]" : "[+]"} {session.code} {session.isOpen ? "(aberta)" : "(fechada)"} - {session.ordersCount} pedido(s) - {formatBRL(session.subtotal)}
                      </button>
                      <a href={`/api/orders/sessions/${session.id}/export`} style={tinyBtn}>
                        Exportar Excel
                      </a>
                    </div>
                    <div style={{ ...small, marginTop: 4 }}>
                      aberto: {new Date(session.openedAt).toLocaleString("pt-BR")}
                      {session.closedAt ? ` | fechado: ${new Date(session.closedAt).toLocaleString("pt-BR")}` : ""}
                    </div>

                    {isOpen ? (
                      <div style={{ marginTop: 8, paddingLeft: 12, display: "grid", gap: 4 }}>
                        {isLoadingOrders ? (
                          <div style={small}>|-- carregando pedidos...</div>
                        ) : sessionOrders.length ? (
                          sessionOrders.map((order) => (
                            <div key={order.id} style={{ fontSize: 13 }}>
                              |-- {order.code} [{order.status}] {order.source === "mesa_qr" && order.tableCode ? `Mesa ${order.tableCode}` : "Balcão"} {formatBRL(order.subtotal)} ({new Date(order.createdAt).toLocaleString("pt-BR")})
                            </div>
                          ))
                        ) : (
                          <div style={small}>|-- sem pedidos nessa sessão</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
