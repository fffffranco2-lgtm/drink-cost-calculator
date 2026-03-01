"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";
import {
  internalButtonStyle,
  internalCardStyle,
  internalFocusStyle,
  internalHeaderCardStyle,
  internalPageStyle,
  internalSmallTextStyle,
} from "@/app/admin/internal-theme";

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

  const page: React.CSSProperties = { ...internalPageStyle };
  const container: React.CSSProperties = { maxWidth: 1100, margin: "0 auto" };
  const card: React.CSSProperties = { ...internalCardStyle };
  const headerCard: React.CSSProperties = { ...internalHeaderCardStyle };
  const small: React.CSSProperties = { ...internalSmallTextStyle };
  const btn: React.CSSProperties = {
    ...internalButtonStyle,
    fontWeight: 700,
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
  };
  const tinyBtn: React.CSSProperties = {
    ...btn,
    borderRadius: 8,
    padding: "4px 8px",
    fontSize: 12,
  };

  return (
    <div style={page}>
      <style>{internalFocusStyle}</style>
      <div style={container}>
        <div style={{ ...headerCard, marginBottom: 12, position: "relative", paddingRight: 64 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 20 }}>Histórico de Pedidos</h1>
              <div style={small}>Visualização em árvore de sessões e pedidos</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href="/admin/pedidos" style={btn}>
                Pedidos em tempo real
              </Link>
              <Link href="/admin/mesas" style={btn}>
                Mesas
              </Link>
              <Link href="/admin" style={btn}>
                Área interna
              </Link>
            </div>
          </div>
          {error ? <div style={{ ...small, color: "#b00020", marginTop: 8 }}>{error}</div> : null}
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
            onClick={() => void loadHistory()}
            disabled={loading}
            aria-label={loading ? "Atualizando histórico" : "Atualizar histórico"}
            title={loading ? "Atualizando..." : "Atualizar"}
          >
            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 20, lineHeight: 1 }}>
              {loading ? "autorenew" : "refresh"}
            </span>
          </button>
        </div>

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
