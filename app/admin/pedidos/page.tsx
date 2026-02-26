"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type OrderStatus = "pendente" | "em_progresso" | "concluido";
type OrderSource = "mesa_qr" | "balcao";

type AdminOrderItem = {
  drinkName: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  notes?: string | null;
  drinkNotes?: string | null;
  itemNotes?: string | null;
};

type AdminOrder = {
  id: string;
  code: string;
  customerName: string | null;
  customerPhone: string | null;
  notes: string | null;
  status: OrderStatus;
  source?: OrderSource | null;
  tableCode?: string | null;
  subtotal: number;
  createdAt: string;
  updatedAt: string;
  items: AdminOrderItem[];
};

type ActiveSession = {
  id: string;
  code: string;
  openedAt: string;
};

const FONT_SCALE = {
  sm: 12,
  md: 14,
  lg: 20,
} as const;

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [ordersUpdatedAt, setOrdersUpdatedAt] = useState<string | null>(null);
  const [expandedCompletedOrders, setExpandedCompletedOrders] = useState<Record<string, boolean>>({});
  const pendingBucketRef = useRef<HTMLDivElement | null>(null);
  const inProgressBucketRef = useRef<HTMLDivElement | null>(null);
  const [completedBucketMaxHeight, setCompletedBucketMaxHeight] = useState<number | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  const loadOrders = useCallback(async (options?: { background?: boolean }) => {
    const background = Boolean(options?.background);
    if (!background) {
      setOrdersLoading(true);
      setOrdersError("");
    }

    try {
      const params = new URLSearchParams();
      if (ordersUpdatedAt) params.set("since", ordersUpdatedAt);
      const endpoint = params.size ? `/api/orders?${params.toString()}` : "/api/orders";
      const res = await fetch(endpoint, { cache: "no-store" });

      if (res.status === 304) return;

      const payload = (await res.json()) as {
        orders?: AdminOrder[];
        updatedAt?: string | null;
        error?: string;
        session?: { isOpen?: boolean; id?: string; code?: string; openedAt?: string };
      };
      if (!res.ok) {
        setOrdersError(payload.error ?? "Falha ao carregar pedidos.");
        return;
      }
      if (payload.session?.isOpen && payload.session.id && payload.session.code && payload.session.openedAt) {
        setActiveSession({ id: payload.session.id, code: payload.session.code, openedAt: payload.session.openedAt });
      } else {
        setActiveSession(null);
      }

      const normalizedOrders = (Array.isArray(payload.orders) ? payload.orders : []).map((order) => ({
        ...order,
        items: (Array.isArray(order.items) ? order.items : []).map((item) => {
          const notes =
            typeof item.drinkNotes === "string"
              ? item.drinkNotes
              : typeof item.itemNotes === "string"
              ? item.itemNotes
              : typeof item.notes === "string"
              ? item.notes
              : null;
          return {
            ...item,
            notes,
            drinkNotes: notes,
          };
        }),
      }));

      setOrders(normalizedOrders);
      setOrdersUpdatedAt(typeof payload.updatedAt === "string" ? payload.updatedAt : null);
    } catch {
      if (!background) setOrdersError("Erro de rede ao carregar pedidos.");
    } finally {
      if (!background) setOrdersLoading(false);
    }
  }, [ordersUpdatedAt]);

  const openBar = useCallback(async () => {
    setSessionLoading(true);
    setOrdersError("");
    try {
      const res = await fetch("/api/orders/session", { method: "POST" });
      const payload = (await res.json()) as {
        isOpen?: boolean;
        session?: { id: string; code: string; openedAt: string };
        error?: string;
      };
      if (!res.ok) {
        setOrdersError(payload.error ?? "Falha ao abrir o bar.");
        return;
      }
      if (payload.session) {
        setActiveSession(payload.session);
      }
      setOrdersUpdatedAt(null);
      await loadOrders();
    } catch {
      setOrdersError("Erro de rede ao abrir o bar.");
    } finally {
      setSessionLoading(false);
    }
  }, [loadOrders]);

  const closeBar = useCallback(async () => {
    setSessionLoading(true);
    setOrdersError("");
    try {
      const res = await fetch("/api/orders/session", { method: "PATCH" });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setOrdersError(payload.error ?? "Falha ao fechar o bar.");
        return;
      }
      setActiveSession(null);
      setOrders([]);
      setOrdersUpdatedAt(null);
    } catch {
      setOrdersError("Erro de rede ao fechar o bar.");
    } finally {
      setSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
    const interval = setInterval(() => {
      void loadOrders({ background: true });
    }, 15000);
    return () => clearInterval(interval);
  }, [loadOrders]);

  const moveOrderTo = useCallback(
    async (orderId: string, status: OrderStatus) => {
      setUpdatingOrderId(orderId);
      setOrdersError("");
      try {
        const res = await fetch(`/api/orders/${orderId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        const payload = (await res.json()) as { error?: string };
        if (!res.ok) {
          setOrdersError(payload.error ?? "Falha ao atualizar pedido.");
          return;
        }
        await loadOrders();
      } catch {
        setOrdersError("Erro de rede ao atualizar pedido.");
      } finally {
        setUpdatingOrderId(null);
      }
    },
    [loadOrders]
  );

  const groupedOrders = useMemo(
    () => ({
      pendente: orders.filter((order) => order.status === "pendente"),
      em_progresso: orders.filter((order) => order.status === "em_progresso"),
      concluido: orders.filter((order) => order.status === "concluido"),
    }),
    [orders]
  );

  const formatOrderDate = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const toggleCompletedOrderCard = useCallback((orderId: string) => {
    setExpandedCompletedOrders((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  }, []);

  useEffect(() => {
    const updateCompletedBucketMaxHeight = () => {
      const pendingHeight = pendingBucketRef.current?.offsetHeight ?? 0;
      const inProgressHeight = inProgressBucketRef.current?.offsetHeight ?? 0;
      const maxHeight = Math.max(pendingHeight, inProgressHeight);
      setCompletedBucketMaxHeight(maxHeight > 0 ? maxHeight : null);
    };

    updateCompletedBucketMaxHeight();
    window.addEventListener("resize", updateCompletedBucketMaxHeight);
    return () => window.removeEventListener("resize", updateCompletedBucketMaxHeight);
  }, [groupedOrders, expandedCompletedOrders, ordersLoading, ordersError]);

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

  const container: React.CSSProperties = { maxWidth: 1200, margin: "0 auto" };
  const card: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: 14,
  };
  const small: React.CSSProperties = { fontSize: FONT_SCALE.sm, color: "var(--muted)" };
  const btn: React.CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "white",
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 700,
    color: "var(--ink)",
  };

  return (
    <div style={page}>
      <style>{`@media (max-width: 980px) { .orders-grid { grid-template-columns: 1fr !important; } }`}</style>
      <div style={container}>
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: FONT_SCALE.lg }}>Pedidos</h1>
              <div style={small}>Operação da cozinha/bar em tempo real</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href="/admin" style={{ ...btn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                Área interna
              </Link>
              <Link href="/" style={{ ...btn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                Cardápio público
              </Link>
              <Link href="/admin/pedidos/historico" style={{ ...btn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                Histórico
              </Link>
              <button style={btn} onClick={() => void loadOrders()} disabled={ordersLoading || Boolean(updatingOrderId)}>
                {ordersLoading ? "Atualizando..." : "Atualizar"}
              </button>
              <button
                style={{ ...btn, background: activeSession ? "#fef3c7" : "#dcfce7", borderColor: activeSession ? "#e7c981" : "#9fdbab" }}
                onClick={() => {
                  if (activeSession) {
                    void closeBar();
                  } else {
                    void openBar();
                  }
                }}
                disabled={sessionLoading}
              >
                {sessionLoading ? "Processando..." : activeSession ? "Fechar bar" : "Abrir bar"}
              </button>
            </div>
          </div>
          <div style={{ ...small, marginTop: 8 }}>
            {activeSession ? `Sessão aberta: ${activeSession.code}` : "Bar fechado"} • {orders.length} pedido(s)
          </div>
          {ordersError ? <div style={{ ...small, color: "#b00020", marginTop: 8 }}>{ordersError}</div> : null}
        </div>

        <div className="orders-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          {([
            ["pendente", "Pendentes"],
            ["em_progresso", "Em progresso"],
            ["concluido", "Concluídos"],
          ] as Array<[OrderStatus, string]>).map(([statusKey, title]) => (
            <div
              key={statusKey}
              ref={statusKey === "pendente" ? pendingBucketRef : statusKey === "em_progresso" ? inProgressBucketRef : undefined}
              style={{
                ...card,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                maxHeight: statusKey === "concluido" && completedBucketMaxHeight ? completedBucketMaxHeight : undefined,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <strong style={{ fontSize: FONT_SCALE.md }}>{title}</strong>
                <div style={small}>{groupedOrders[statusKey].length}</div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  overflowY: statusKey === "concluido" && completedBucketMaxHeight ? "auto" : "visible",
                  paddingRight: statusKey === "concluido" ? 4 : 0,
                }}
              >
                {groupedOrders[statusKey].map((order) => {
                  const isCompletedCard = statusKey === "concluido";
                  const isExpanded = !isCompletedCard || Boolean(expandedCompletedOrders[order.id]);
                  const statusCardBackground =
                    statusKey === "pendente" ? "#fff1f1" : statusKey === "em_progresso" ? "#fff8df" : "#ecfdf3";
                  const statusCardBorder =
                    statusKey === "pendente" ? "#f2cccc" : statusKey === "em_progresso" ? "#eed9a7" : "#bfe8cf";
                  const statusButtonStyle: React.CSSProperties =
                    statusKey === "pendente"
                      ? { background: "#fde2e2", borderColor: "#e9b9b9" }
                      : statusKey === "em_progresso"
                      ? { background: "#fdf0c4", borderColor: "#e8d08d" }
                      : { background: "#dcfce7", borderColor: "#a7d9bc" };

                  return (
                    <div
                      key={order.id}
                      onClick={isCompletedCard ? () => toggleCompletedOrderCard(order.id) : undefined}
                      style={{
                        border: `1px solid ${statusCardBorder}`,
                        borderRadius: 10,
                        padding: 9,
                        background: statusCardBackground,
                        cursor: isCompletedCard ? "pointer" : "default",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                        <div style={{ fontWeight: 700, fontSize: FONT_SCALE.sm }}>{order.code}</div>
                        <div style={{ ...small, fontSize: FONT_SCALE.sm }}>
                          {formatOrderDate(order.createdAt)}
                          {isCompletedCard ? (isExpanded ? " • recolher" : " • expandir") : ""}
                        </div>
                      </div>

                      <div style={{ ...small, marginTop: 4 }}>
                        {(order.customerName || "Cliente não informado") + (order.customerPhone ? ` • ${order.customerPhone}` : "")}
                      </div>

                      <div style={{ ...small, marginTop: 2 }}>
                        Origem: {order.source === "mesa_qr" && order.tableCode ? `Mesa ${order.tableCode}` : "Balcão"}
                      </div>

                      {isExpanded ? (
                        <>
                          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                            {order.items.map((item, idx) => (
                              <div key={`${order.id}_${idx}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: FONT_SCALE.sm }}>
                                <div style={{ display: "grid", gap: 2 }}>
                                  <div>
                                    {item.qty}x {item.drinkName}
                                  </div>
                                  {item.drinkNotes || item.notes ? (
                                    <div style={{ ...small, fontSize: FONT_SCALE.sm, marginLeft: 12 }}>{item.drinkNotes ?? item.notes}</div>
                                  ) : null}
                                </div>
                                <div>{formatBRL(item.lineTotal)}</div>
                              </div>
                            ))}
                          </div>

                          {order.notes ? <div style={{ ...small, marginTop: 6 }}>Obs: {order.notes}</div> : null}

                          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "34px 1fr 34px", alignItems: "center", gap: 8 }}>
                            {statusKey === "em_progresso" || statusKey === "concluido" ? (
                              <button
                                aria-label="Mover para a esquerda"
                                style={{ ...btn, ...statusButtonStyle, width: 34, height: 34, padding: 0, borderRadius: 999, fontSize: FONT_SCALE.lg, lineHeight: 1 }}
                                disabled={updatingOrderId === order.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void moveOrderTo(order.id, statusKey === "em_progresso" ? "pendente" : "em_progresso");
                                }}
                              >
                                ←
                              </button>
                            ) : (
                              <div />
                            )}

                            <strong style={{ fontSize: FONT_SCALE.md, textAlign: "center" }}>Total: {formatBRL(order.subtotal)}</strong>

                            {statusKey === "pendente" || statusKey === "em_progresso" ? (
                              <button
                                aria-label="Mover para a direita"
                                style={{ ...btn, ...statusButtonStyle, width: 34, height: 34, padding: 0, borderRadius: 999, fontSize: FONT_SCALE.lg, lineHeight: 1 }}
                                disabled={updatingOrderId === order.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void moveOrderTo(order.id, statusKey === "pendente" ? "em_progresso" : "concluido");
                                }}
                              >
                                →
                              </button>
                            ) : (
                              <div />
                            )}
                          </div>
                        </>
                      ) : null}
                    </div>
                  );
                })}

                {groupedOrders[statusKey].length === 0 && (
                  <div style={{ padding: 12, border: "1px dashed var(--border)", borderRadius: 12, color: "var(--muted)", fontSize: FONT_SCALE.sm }}>
                    Sem pedidos nesta coluna.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
