"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AUTO_PRINT_STORAGE_KEY,
  PRINT_MODE_STORAGE_KEY,
  QZ_PRINTER_STORAGE_KEY,
  type PrintMode,
  type QzApi,
  type QzConnectionState,
  type QzPrintConfigOptions,
  type QzPrintData,
} from "@/lib/qz-tray";

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
const BAR_LOGO_PATH = "/manteca-logo.svg";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatBRLPrint(value: number) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const [rawInt, cents] = abs.toFixed(2).split(".");
  const groupedInt = rawInt.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${groupedInt},${cents}`;
}

function toLatin1Safe(value: string) {
  const normalized = value
    .normalize("NFC")
    .replaceAll("’", "'")
    .replaceAll("‘", "'")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replaceAll("…", "...");

  let output = "";
  for (const char of normalized) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 255)) {
      output += char;
    } else {
      output += "?";
    }
  }
  return output;
}

function wrapText(text: string, width: number) {
  if (width <= 0) return [text];
  const parts: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const baseLine of lines) {
    let line = baseLine.trim();
    if (!line) {
      parts.push("");
      continue;
    }
    while (line.length > width) {
      const chunk = line.slice(0, width);
      const breakAt = chunk.lastIndexOf(" ");
      if (breakAt > Math.floor(width * 0.5)) {
        parts.push(chunk.slice(0, breakAt).trimEnd());
        line = line.slice(breakAt + 1).trimStart();
      } else {
        parts.push(chunk);
        line = line.slice(width);
      }
    }
    parts.push(line);
  }
  return parts.length ? parts : [""];
}

function leftRightLine(left: string, right: string, width: number) {
  const safeLeft = left.trim();
  const safeRight = right.trim();
  const minGap = 1;
  const maxLeftLen = Math.max(0, width - safeRight.length - minGap);
  const croppedLeft = safeLeft.length > maxLeftLen ? safeLeft.slice(0, maxLeftLen) : safeLeft;
  const spaces = Math.max(minGap, width - croppedLeft.length - safeRight.length);
  return `${croppedLeft}${" ".repeat(spaces)}${safeRight}`;
}

function centerLine(text: string, width: number) {
  const safe = text.trim();
  if (safe.length >= width) return safe.slice(0, width);
  const leftPadding = Math.floor((width - safe.length) / 2);
  return `${" ".repeat(leftPadding)}${safe}`;
}

function buildEscPosTicket(order: AdminOrder) {
  const width = 32;
  const nl = "\n";
  const sourceText = order.source === "mesa_qr" && order.tableCode ? `Mesa ${order.tableCode}` : "Balcao";
  const customerName = order.customerName || "Cliente nao informado";
  const phone = order.customerPhone ? ` - ${order.customerPhone}` : "";
  const createdAt = new Date(order.createdAt).toLocaleString("pt-BR");

  const out: string[] = [];
  out.push("\x1B\x40"); // init
  out.push("\x1B\x45\x01"); // bold on
  out.push("\x1B\x61\x01");
  out.push(`${toLatin1Safe(centerLine("PEDIDO", width))}${nl}`);
  out.push(`${toLatin1Safe(centerLine(order.code, width))}${nl}`);
  out.push("\x1B\x45\x00"); // bold off
  out.push("\x1B\x61\x00");
  out.push(`${"=".repeat(width)}${nl}`);
  out.push(`${toLatin1Safe(createdAt)}${nl}`);
  out.push(`${toLatin1Safe(sourceText)}${nl}`);
  out.push(`${toLatin1Safe(customerName + phone)}${nl}`);
  out.push(`${"-".repeat(width)}${nl}`);

  for (const item of order.items) {
    const name = toLatin1Safe(item.drinkName);
    const qtyPrice = toLatin1Safe(`${item.qty} x ${formatBRLPrint(item.unitPrice)}`);
    const total = toLatin1Safe(formatBRLPrint(item.lineTotal));
    for (const line of wrapText(name, width)) {
      out.push(`${line}${nl}`);
    }
    out.push(`${leftRightLine(`  ${qtyPrice}`, total, width)}${nl}`);
    const notes = item.drinkNotes ?? item.notes;
    if (notes) {
      for (const line of wrapText(`obs: ${toLatin1Safe(notes)}`, width - 2)) {
        out.push(`  ${line}${nl}`);
      }
    }
    out.push(nl);
  }

  out.push(`${"-".repeat(width)}${nl}`);
  out.push(`${leftRightLine("ITENS", String(order.items.reduce((acc, item) => acc + item.qty, 0)), width)}${nl}`);
  if (order.notes) {
    for (const line of wrapText(`Obs pedido: ${toLatin1Safe(order.notes)}`, width)) {
      out.push(`${line}${nl}`);
    }
    out.push(nl);
  }
  out.push(`${"=".repeat(width)}${nl}`);
  out.push("\x1B\x45\x01"); // bold on
  out.push(`${leftRightLine("TOTAL", toLatin1Safe(formatBRLPrint(order.subtotal)), width)}${nl}`);
  out.push("\x1B\x45\x00"); // bold off
  out.push(`${nl}${nl}`);
  out.push("\x1D\x56\x41\x10"); // full cut
  return out.join("");
}

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
  const [printOrderState, setPrintOrderState] = useState<AdminOrder | null>(null);
  const [printMode, setPrintMode] = useState<PrintMode>("qz");
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(false);
  const [qzConnectionState, setQzConnectionState] = useState<QzConnectionState>("disconnected");
  const [qzBusy, setQzBusy] = useState(false);
  const qzLoaderRef = useRef<Promise<QzApi> | null>(null);
  const qzSecurityReadyRef = useRef(false);
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

  const printOrder = useCallback((order: AdminOrder) => {
    setPrintOrderState(order);
    window.setTimeout(() => window.print(), 120);
  }, []);

  const loadQz = useCallback(async () => {
    if (window.qz) return window.qz;
    if (qzLoaderRef.current) return qzLoaderRef.current;

    qzLoaderRef.current = new Promise<QzApi>((resolve, reject) => {
      const scriptSources = [
        "https://cdn.jsdelivr.net/npm/qz-tray@2.2.5/qz-tray.js",
        "https://unpkg.com/qz-tray@2.2.5/qz-tray.js",
        "https://localhost:8181/qz-tray.js",
        "http://localhost:8181/qz-tray.js",
        "https://localhost:8182/qz-tray.js",
        "http://localhost:8182/qz-tray.js",
      ];

      const tryLoad = (index: number) => {
        if (window.qz) {
          resolve(window.qz);
          return;
        }
        if (index >= scriptSources.length) {
          reject(new Error("Não foi possível carregar qz-tray.js (CDN e localhost 8181/8182)."));
          return;
        }

        const script = document.createElement("script");
        script.src = scriptSources[index];
        script.async = true;
        script.onload = () => {
          if (window.qz) {
            resolve(window.qz);
          } else {
            tryLoad(index + 1);
          }
        };
        script.onerror = () => {
          script.remove();
          tryLoad(index + 1);
        };
        document.head.appendChild(script);
      };

      tryLoad(0);
    });

    try {
      return await qzLoaderRef.current;
    } catch (error) {
      qzLoaderRef.current = null;
      throw error;
    }
  }, []);

  const configureQzSecurity = useCallback(async (qz: QzApi) => {
    if (qzSecurityReadyRef.current) return;
    if (!qz.security?.setCertificatePromise || !qz.security?.setSignaturePromise) {
      throw new Error("API de segurança do QZ Tray indisponível.");
    }

    const certRes = await fetch("/api/qz/certificate", { cache: "no-store" });
    const certText = await certRes.text();
    if (!certRes.ok) {
      throw new Error(certText || "Falha ao carregar certificado QZ.");
    }

    const certificate = certText.trim();
    if (!certificate) {
      throw new Error("Certificado QZ vazio.");
    }

    qz.security.setSignatureAlgorithm?.("SHA512");
    qz.security.setCertificatePromise((resolve) => resolve(certificate));
    qz.security.setSignaturePromise(async (toSign) => {
      const signRes = await fetch("/api/qz/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toSign }),
      });
      const payload = (await signRes.json()) as { signature?: string; error?: string };
      if (!signRes.ok || !payload.signature) {
        throw new Error(payload.error ?? "Falha ao assinar requisição QZ.");
      }
      return payload.signature;
    });

    qzSecurityReadyRef.current = true;
  }, []);

  const resolveQzPrinter = useCallback(async (qz: QzApi) => {
    let typedName = "";
    try {
      typedName = (localStorage.getItem(QZ_PRINTER_STORAGE_KEY) ?? "").trim();
    } catch {
      // ignorar indisponibilidade de storage
    }
    if (typedName) return typedName;

    if (typeof qz.printers.getDefault === "function") {
      const defaultPrinter = await qz.printers.getDefault();
      if (defaultPrinter?.trim()) return defaultPrinter.trim();
    }

    const discovered = await qz.printers.find();
    if (typeof discovered === "string" && discovered.trim()) {
      return discovered.trim();
    }
    if (Array.isArray(discovered) && discovered.length && discovered[0].trim()) {
      return discovered[0].trim();
    }
    throw new Error("Nenhuma impressora encontrada pelo QZ Tray.");
  }, []);

  const printOrderViaQz = useCallback(async (order: AdminOrder) => {
    setQzBusy(true);
    setOrdersError("");
    try {
      const qz = await loadQz();
      await configureQzSecurity(qz);
      if (!qz.websocket.isActive()) {
        await qz.websocket.connect({ retries: 2, delay: 1 });
      }
      setQzConnectionState("connected");

      const printerName = await resolveQzPrinter(qz);
      const config = qz.configs.create(printerName, { encoding: "ISO-8859-1", copies: 1 });
      const ticket = buildEscPosTicket(order);

      try {
        await qz.print(config, [{ type: "raw", format: "command", flavor: "plain", data: ticket }]);
      } catch {
        await qz.print(config, [{ type: "raw", format: "plain", data: ticket }]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao imprimir via QZ Tray.";
      setOrdersError(message);
      setQzConnectionState("disconnected");
    } finally {
      setQzBusy(false);
    }
  }, [configureQzSecurity, loadQz, resolveQzPrinter]);

  const printOrderWithMode = useCallback(async (order: AdminOrder) => {
    if (printMode === "qz") {
      await printOrderViaQz(order);
      return;
    }
    printOrder(order);
  }, [printMode, printOrderViaQz, printOrder]);

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem(PRINT_MODE_STORAGE_KEY);
      if (savedMode === "qz" || savedMode === "browser") {
        setPrintMode(savedMode);
      }
      const savedAutoPrint = localStorage.getItem(AUTO_PRINT_STORAGE_KEY);
      if (savedAutoPrint === "1") setAutoPrintEnabled(true);
    } catch {
      // ignorar indisponibilidade de storage
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_PRINT_STORAGE_KEY, autoPrintEnabled ? "1" : "0");
    } catch {
      // ignorar indisponibilidade de storage
    }
  }, [autoPrintEnabled]);

  const refreshQzWindowConnection = useCallback(() => {
    try {
      setQzConnectionState(window.qz?.websocket.isActive() ? "connected" : "disconnected");
    } catch {
      setQzConnectionState("disconnected");
    }
  }, []);

  useEffect(() => {
    refreshQzWindowConnection();
    const interval = window.setInterval(refreshQzWindowConnection, 2000);
    return () => window.clearInterval(interval);
  }, [refreshQzWindowConnection]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PRINT_MODE_STORAGE_KEY) {
        const nextMode = event.newValue;
        if (nextMode === "qz" || nextMode === "browser") {
          setPrintMode(nextMode);
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

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
        await printOrderWithMode(order);
      }
    });
  }, [orders, autoPrintEnabled, printOrderWithMode]);

  useEffect(() => {
    const handleAfterPrint = () => {
      setPrintOrderState(null);
    };
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
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

  useEffect(() => {
    const updateKanbanViewportMaxHeight = () => {
      const top = ordersGridRef.current?.getBoundingClientRect().top ?? 0;
      const available = Math.floor(window.innerHeight - top - KANBAN_VERTICAL_GAP);
      setKanbanViewportMaxHeight(available > 260 ? available : 260);
    };

    updateKanbanViewportMaxHeight();
    window.addEventListener("resize", updateKanbanViewportMaxHeight);
    return () => window.removeEventListener("resize", updateKanbanViewportMaxHeight);
  }, [orders.length, ordersError, printMode, autoPrintEnabled]);

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

  const printText = useCallback((value: string | null | undefined, fallback = "") => {
    const raw = typeof value === "string" ? value : fallback;
    return toLatin1Safe(raw);
  }, []);

  return (
    <div style={page}>
      <style>{`
        @media (max-width: 980px) { .orders-grid { grid-template-columns: 1fr !important; } }
        .print-ticket-root { display: none; }
        @media print {
          @page { size: 58mm auto; margin: 2mm; }
          .app-shell { display: none !important; }
          .print-ticket-root {
            display: block;
            width: 54mm;
            color: #000;
            font-family: "Courier New", Courier, monospace;
            font-size: 11px;
          }
          .print-ticket-logo-wrap { text-align: center; margin-bottom: 4px; }
          .print-ticket-logo { width: 34mm; height: auto; object-fit: contain; }
          .print-ticket-title { text-align: center; font-weight: 700; letter-spacing: 0.5px; }
          .print-ticket-code { text-align: center; font-weight: 700; margin-top: 1px; }
          .print-ticket-meta { margin-top: 2px; line-height: 1.25; }
          .print-ticket-item { margin-top: 6px; }
          .print-ticket-item-name { line-height: 1.2; word-break: break-word; }
          .print-ticket-line { border-top: 1px dashed #000; margin: 5px 0; }
          .print-ticket-row { display: flex; justify-content: space-between; gap: 6px; }
          .print-ticket-notes { margin-left: 8px; margin-top: 1px; font-size: 10px; line-height: 1.2; }
          .print-ticket-total { margin-top: 6px; font-weight: 700; font-size: 12px; border-top: 1px solid #000; padding-top: 4px; }
        }
      `}</style>

      <div className="print-ticket-root" aria-hidden={!printOrderState}>
        {printOrderState ? (
          <div>
            <div className="print-ticket-logo-wrap">
              <img className="print-ticket-logo" src={BAR_LOGO_PATH} alt="Logo do bar" />
            </div>
            <div className="print-ticket-title">PEDIDO</div>
            <div className="print-ticket-code">{printText(printOrderState.code)}</div>
            <div className="print-ticket-line" />
            <div className="print-ticket-meta">{printText(new Date(printOrderState.createdAt).toLocaleString("pt-BR"))}</div>
            <div className="print-ticket-meta">{printText(printOrderState.source === "mesa_qr" && printOrderState.tableCode ? `Mesa ${printOrderState.tableCode}` : "Balcão")}</div>
            <div className="print-ticket-meta">
              {printText(printOrderState.customerName, "Cliente não informado")}
              {printOrderState.customerPhone ? ` - ${printText(printOrderState.customerPhone)}` : ""}
            </div>
            <div className="print-ticket-line" />
            {printOrderState.items.map((item, idx) => (
              <div key={`print_${printOrderState.id}_${idx}`} className="print-ticket-item">
                <div className="print-ticket-item-name">{printText(item.drinkName)}</div>
                <div className="print-ticket-row">
                  <span>{item.qty} x {formatBRLPrint(item.unitPrice)}</span>
                  <span>{formatBRLPrint(item.lineTotal)}</span>
                </div>
                {item.drinkNotes || item.notes ? <div className="print-ticket-notes">obs: {printText(item.drinkNotes ?? item.notes)}</div> : null}
              </div>
            ))}
            <div className="print-ticket-line" />
            <div className="print-ticket-row">
              <span>ITENS</span>
              <span>{printOrderState.items.reduce((acc, item) => acc + item.qty, 0)}</span>
            </div>
            {printOrderState.notes ? <div className="print-ticket-meta">Obs pedido: {printText(printOrderState.notes)}</div> : null}
            <div className="print-ticket-row print-ticket-total">
              <span>TOTAL</span>
              <span>{formatBRLPrint(printOrderState.subtotal)}</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="app-shell" style={container}>
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
              <Link href="/admin/mesas" style={{ ...btn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                Mesas
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
            </div>
            {printMode === "qz" ? (
              <div style={small}>Impressão direta ESC/POS com encoding ISO-8859-1. Ajustes em Configurações &gt; Impressão.</div>
            ) : (
              <div style={small}>Modo fallback usando a janela de impressão do navegador (definido em Configurações &gt; Impressão).</div>
            )}
          </div>
          {ordersError ? <div style={{ ...small, color: "#b00020", marginTop: 8 }}>{ordersError}</div> : null}
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
                {groupedOrders[statusKey].map((order) => {
                  const isCompletedCard = statusKey === "concluido";
                  const isExpanded = !isCompletedCard || Boolean(expandedCompletedOrders[order.id]);
                  const statusCardBackground =
                    statusKey === "pendente" ? "#fff1f1" : statusKey === "em_progresso" ? "#fff8df" : "#ecfdf3";
                  const statusCardBorder =
                    statusKey === "pendente" ? "#f2cccc" : statusKey === "em_progresso" ? "#eed9a7" : "#bfe8cf";

                  return (
                    <div
                      key={order.id}
                      draggable
                      onDragStart={(event) => handleOrderDragStart(event, order.id, statusKey)}
                      onDragEnd={handleOrderDragEnd}
                      onClick={isCompletedCard ? () => toggleCompletedOrderCard(order.id) : undefined}
                      style={{
                        border: `1px solid ${statusCardBorder}`,
                        borderRadius: 10,
                        padding: 9,
                        background: statusCardBackground,
                        cursor: draggingOrder?.id === order.id ? "grabbing" : "grab",
                        opacity: draggingOrder?.id === order.id ? 0.75 : 1,
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
                            <div />

                            <strong style={{ fontSize: FONT_SCALE.md, textAlign: "center" }}>Total: {formatBRL(order.subtotal)}</strong>

                            <button
                              title={printMode === "qz" ? "Imprimir via QZ" : "Imprimir 58mm"}
                              aria-label={printMode === "qz" ? "Imprimir via QZ" : "Imprimir 58mm"}
                              style={{ ...btn, width: 34, height: 34, padding: 0, borderRadius: 999, fontSize: FONT_SCALE.md, lineHeight: 1, background: "#e7f0ff", borderColor: "#bfd4f5" }}
                              disabled={qzBusy}
                              onClick={(e) => {
                                e.stopPropagation();
                                void printOrderWithMode(order);
                              }}
                            >
                              🖨
                            </button>
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
              );
            })()
          ))}
        </div>
      </div>
    </div>
  );
}
