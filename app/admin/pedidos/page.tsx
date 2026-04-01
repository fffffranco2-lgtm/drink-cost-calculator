"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  internalButtonStyle,
  internalCardStyle,
  internalFocusStyle,
  internalHeaderCardStyle,
  internalPageStyle,
  internalSmallTextStyle,
} from "@/app/admin/internal-theme";
import { AUTO_PRINT_STORAGE_KEY } from "@/lib/qz-tray";
import {
  defaultPrintLayout,
  getLayoutsFromStorage,
  resolveActiveLayout,
  QZ_ACTIVE_LAYOUT_STORAGE_KEY,
} from "@/lib/print-layouts";
import { type AdminOrder, type OrderStatus } from "@/lib/orders";
import { usePedidosQzConnection } from "@/app/admin/pedidos/hooks/usePedidosQzConnection";
import { ORDERS_QZ_ACTIVE_LAYOUT_STORAGE_KEY } from "@/app/admin/pedidos/pedidos-print";
import { OrderCard } from "@/app/admin/pedidos/components/OrderCard";

type ActiveSession = {
  id: string;
  code: string;
  openedAt: string;
};

type PrintLayoutOption = {
  id: string;
  name: string;
};

const FONT_SCALE = { sm: 12, md: 14, lg: 20 } as const;

export default function AdminOrdersPage() {
  const KANBAN_VERTICAL_GAP = 12;
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [ordersUpdatedAt, setOrdersUpdatedAt] = useState<string | null>(null);
  const [expandedCompletedOrders, setExpandedCompletedOrders] = useState<Record<string, boolean>>({});
  const [draggingOrder, setDraggingOrder] = useState<{ id: string; from: OrderStatus } | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<OrderStatus | null>(null);
  const ordersGridRef = useRef<HTMLDivElement | null>(null);
  const pendingBucketRef = useRef<HTMLDivElement | null>(null);
  const inProgressBucketRef = useRef<HTMLDivElement | null>(null);
  const [completedBucketMaxHeight, setCompletedBucketMaxHeight] = useState<number | null>(null);
  const [kanbanViewportMaxHeight, setKanbanViewportMaxHeight] = useState<number | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(false);
  const [printLayoutOptions, setPrintLayoutOptions] = useState<PrintLayoutOption[]>([]);
  const [selectedPrintLayoutId, setSelectedPrintLayoutId] = useState(defaultPrintLayout().id);
  const { qzConnectionState, qzBusy, qzError, printOrderViaQz } = usePedidosQzConnection();
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const knownOrdersReadyRef = useRef(false);
  const autoPrintQueueRef = useRef(Promise.resolve());

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
          const drinkName =
            typeof item.drinkName === "string"
              ? item.drinkName
              : typeof (item as unknown as { drink_name?: unknown }).drink_name === "string"
              ? ((item as unknown as { drink_name: string }).drink_name ?? "")
              : "";
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
            drinkName,
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

  const handleOrderDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, orderId: string, from: OrderStatus) => {
      if (updatingOrderId) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", orderId);
      setDraggingOrder({ id: orderId, from });
    },
    [updatingOrderId]
  );

  const handleOrderDragEnd = useCallback(() => {
    setDraggingOrder(null);
    setDragOverStatus(null);
  }, []);

  const handleBucketDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>, target: OrderStatus) => {
      if (!draggingOrder) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = draggingOrder.from === target ? "none" : "move";
      setDragOverStatus(target);
    },
    [draggingOrder]
  );

  const handleBucketDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>, target: OrderStatus) => {
      event.preventDefault();
      setDragOverStatus(null);
      if (!draggingOrder || draggingOrder.from === target) return;
      void moveOrderTo(draggingOrder.id, target);
    },
    [draggingOrder, moveOrderTo]
  );


  useEffect(() => {
    try {
      const savedAutoPrint = localStorage.getItem(AUTO_PRINT_STORAGE_KEY);
      if (savedAutoPrint === "1") setAutoPrintEnabled(true);
    } catch {
      // ignorar indisponibilidade de storage
    }
  }, []);

  const refreshPrintLayouts = useCallback(() => {
    try {
      const layouts = getLayoutsFromStorage();
      const activeLayoutId =
        localStorage.getItem(ORDERS_QZ_ACTIVE_LAYOUT_STORAGE_KEY)?.trim() ||
        localStorage.getItem(QZ_ACTIVE_LAYOUT_STORAGE_KEY)?.trim() ||
        defaultPrintLayout().id;
      const resolvedActive = resolveActiveLayout(layouts, activeLayoutId);
      setPrintLayoutOptions(layouts.map((layout) => ({ id: layout.id, name: layout.name })));
      setSelectedPrintLayoutId(resolvedActive.id);
    } catch {
      const fallback = defaultPrintLayout();
      setPrintLayoutOptions([{ id: fallback.id, name: fallback.name }]);
      setSelectedPrintLayoutId(fallback.id);
    }
  }, []);

  useEffect(() => {
    refreshPrintLayouts();
    const handleFocus = () => refreshPrintLayouts();
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === "orders_qz_layouts" ||
        event.key === ORDERS_QZ_ACTIVE_LAYOUT_STORAGE_KEY ||
        event.key === QZ_ACTIVE_LAYOUT_STORAGE_KEY
      ) {
        refreshPrintLayouts();
      }
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
    };
  }, [refreshPrintLayouts]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_PRINT_STORAGE_KEY, autoPrintEnabled ? "1" : "0");
    } catch {
      // ignorar indisponibilidade de storage
    }
  }, [autoPrintEnabled]);


  useEffect(() => {
    if (!orders.length) return;

    if (!knownOrdersReadyRef.current) {
      knownOrderIdsRef.current = new Set(orders.map((order) => order.id));
      knownOrdersReadyRef.current = true;
      return;
    }

    const newPendingOrders = orders.filter((order) => !knownOrderIdsRef.current.has(order.id) && order.status === "pendente");
    for (const order of orders) knownOrderIdsRef.current.add(order.id);
    if (!autoPrintEnabled || !newPendingOrders.length) return;

    autoPrintQueueRef.current = autoPrintQueueRef.current.then(async () => {
      for (const order of newPendingOrders) {
        await printOrderViaQz(order);
      }
    });
  }, [orders, autoPrintEnabled, printOrderViaQz]);

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

  useEffect(() => {
    const updateKanbanViewportMaxHeight = () => {
      const top = ordersGridRef.current?.getBoundingClientRect().top ?? 0;
      const available = Math.floor(window.innerHeight - top - KANBAN_VERTICAL_GAP);
      setKanbanViewportMaxHeight(available > 260 ? available : 260);
    };

    updateKanbanViewportMaxHeight();
    window.addEventListener("resize", updateKanbanViewportMaxHeight);
    return () => window.removeEventListener("resize", updateKanbanViewportMaxHeight);
  }, [orders.length, ordersError, autoPrintEnabled]);

  const page: React.CSSProperties = { ...internalPageStyle };
  const container: React.CSSProperties = { maxWidth: 1200, margin: "0 auto" };
  const card: React.CSSProperties = { ...internalCardStyle };
  const headerCard: React.CSSProperties = { ...internalHeaderCardStyle };
  const small: React.CSSProperties = { ...internalSmallTextStyle, fontSize: FONT_SCALE.sm };
  const btn: React.CSSProperties = { ...internalButtonStyle, fontWeight: 700 };

  return (
    <div style={page}>
      <style>{`${internalFocusStyle}
        @media (max-width: 980px) { .orders-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      <div className="app-shell" style={container}>
        <div style={{ ...headerCard, marginBottom: 12, position: "relative", paddingRight: 64 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: FONT_SCALE.lg }}>Pedidos</h1>
              <div style={small}>Operação da cozinha/bar em tempo real</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href="/admin/pedidos/historico" style={{ ...btn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                Histórico
              </Link>
              <Link
                href="/admin/impressao"
                style={{
                  ...btn,
                  width: 36,
                  height: 36,
                  padding: 0,
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                }}
                title="Layouts de impressão"
                aria-label="Layouts de impressão"
              >
                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>
                  settings
                </span>
              </Link>
              <button
                style={{ ...btn, background: activeSession ? "var(--pill)" : "var(--pillActive)", borderColor: activeSession ? "#ddc7aa" : "#b7d9d4" }}
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
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ ...small, fontWeight: 700 }}>Impressão</div>
              <span
                title={qzConnectionState === "connected" ? "QZ conectado nesta janela" : "QZ desconectado nesta janela"}
                aria-label={qzConnectionState === "connected" ? "QZ conectado nesta janela" : "QZ desconectado nesta janela"}
                style={{
                  width: 10,
                  height: 10,
                  display: "inline-block",
                  borderRadius: 999,
                  background: qzConnectionState === "connected" ? "#16a34a" : "#dc2626",
                  boxShadow: qzConnectionState === "connected" ? "0 0 8px rgba(22, 163, 74, 0.5)" : "0 0 8px rgba(220, 38, 38, 0.45)",
                  border: "1px solid rgba(0,0,0,0.12)",
                }}
              />
              {autoPrintEnabled ? (
                <span
                  style={{
                    fontSize: FONT_SCALE.sm,
                    fontWeight: 700,
                    color: "#0f5132",
                    background: "#d1fae5",
                    border: "1px solid #86efac",
                    borderRadius: 999,
                    padding: "2px 8px",
                  }}
                >
                  Autoimpressão ativa
                </span>
              ) : null}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, ...small }}>
                <input
                  type="checkbox"
                  checked={autoPrintEnabled}
                  onChange={(e) => setAutoPrintEnabled(e.target.checked)}
                  disabled={qzBusy}
                />
                Autoimprimir pedidos novos
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, ...small }}>
                Preset:
                <select
                  value={selectedPrintLayoutId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedPrintLayoutId(nextId);
                    try {
                      localStorage.setItem(ORDERS_QZ_ACTIVE_LAYOUT_STORAGE_KEY, nextId);
                    } catch {
                      // ignorar indisponibilidade de storage
                    }
                  }}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "#fff",
                    padding: "6px 8px",
                    minWidth: 180,
                    fontSize: FONT_SCALE.sm,
                  }}
                >
                  {printLayoutOptions.map((layout) => (
                    <option key={layout.id} value={layout.id}>
                      {layout.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div style={small}>Impressão direta ESC/POS com encoding ISO-8859-1. Ajustes em Configurações &gt; Impressão.</div>
          </div>
          {(ordersError || qzError) ? <div style={{ ...small, color: "#b00020", marginTop: 8 }}>{ordersError || qzError}</div> : null}
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
            onClick={() => void loadOrders()}
            disabled={ordersLoading || Boolean(updatingOrderId)}
            aria-label={ordersLoading ? "Atualizando pedidos" : "Atualizar pedidos"}
            title={ordersLoading ? "Atualizando..." : "Atualizar"}
          >
            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 20, lineHeight: 1 }}>
              {ordersLoading ? "autorenew" : "refresh"}
            </span>
          </button>
        </div>

        <div ref={ordersGridRef} className="orders-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          {([
            ["pendente", "Pendentes"],
            ["em_progresso", "Em progresso"],
            ["concluido", "Concluídos"],
          ] as Array<[OrderStatus, string]>).map(([statusKey, title]) => (
            (() => {
              const columnMaxHeight =
                statusKey === "concluido" && completedBucketMaxHeight
                  ? kanbanViewportMaxHeight
                    ? Math.min(completedBucketMaxHeight, kanbanViewportMaxHeight)
                    : completedBucketMaxHeight
                  : kanbanViewportMaxHeight;

              return (
            <div
              key={statusKey}
              ref={statusKey === "pendente" ? pendingBucketRef : statusKey === "em_progresso" ? inProgressBucketRef : undefined}
              onDragOver={(event) => handleBucketDragOver(event, statusKey)}
              onDrop={(event) => handleBucketDrop(event, statusKey)}
              onDragLeave={() => setDragOverStatus((current) => (current === statusKey ? null : current))}
              style={{
                ...card,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                maxHeight: columnMaxHeight ?? undefined,
                boxShadow: dragOverStatus === statusKey ? "inset 0 0 0 2px #7da6d8" : undefined,
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
                  overflowY: columnMaxHeight ? "auto" : "visible",
                  paddingRight: columnMaxHeight ? 4 : 0,
                }}
              >
                {groupedOrders[statusKey].map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    statusKey={statusKey}
                    isDragging={draggingOrder?.id === order.id}
                    isExpanded={statusKey !== "concluido" || Boolean(expandedCompletedOrders[order.id])}
                    qzBusy={qzBusy}
                    btn={btn}
                    small={small}
                    formatOrderDate={formatOrderDate}
                    onDragStart={(event) => handleOrderDragStart(event, order.id, statusKey)}
                    onDragEnd={handleOrderDragEnd}
                    onToggle={() => toggleCompletedOrderCard(order.id)}
                    onPrint={() => void printOrderViaQz(order)}
                  />
                ))}

                {groupedOrders[statusKey].length === 0 && (
                  <div style={{ padding: 12, border: "1px dashed var(--border)", borderRadius: 12, color: "var(--muted)", fontSize: FONT_SCALE.sm }}>
                    Sem pedidos nesta coluna.
                  </div>
                )}
              </div>
            </div>
              );
            })()
          ))}
        </div>
      </div>
    </div>
  );
}
