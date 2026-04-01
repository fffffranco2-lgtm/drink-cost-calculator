"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QZ_PRINTER_STORAGE_KEY, type QzApi, type QzConnectionState } from "@/lib/qz-tray";
import { type PrintLayout } from "@/lib/print-layouts";
import { type AdminOrder } from "@/lib/orders";
import { choosePreferredPrinter } from "@/lib/utils";
import { toLatin1Safe } from "@/lib/escpos";
import { buildEscPosTicket, formatBRLPrint, readActivePrintLayout } from "@/app/admin/pedidos/pedidos-print";

export type UsePedidosQzConnectionResult = {
  qzConnectionState: QzConnectionState;
  qzBusy: boolean;
  qzError: string;
  setQzError: (msg: string) => void;
  printOrderViaQz: (order: AdminOrder) => Promise<void>;
};

export function usePedidosQzConnection(): UsePedidosQzConnectionResult {
  const [qzConnectionState, setQzConnectionState] = useState<QzConnectionState>("disconnected");
  const [qzBusy, setQzBusy] = useState(false);
  const [qzError, setQzError] = useState("");
  const qzLoaderRef = useRef<Promise<QzApi> | null>(null);
  const qzSecurityReadyRef = useRef(false);

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
    if (typedName) {
      const typedFound = await qz.printers.find(typedName);
      const typedList = typeof typedFound === "string" ? [typedFound] : typedFound;
      if (Array.isArray(typedList)) {
        const exactMatch = typedList.find((name) => name.trim().toLowerCase() === typedName.toLowerCase());
        if (exactMatch?.trim()) return exactMatch.trim();
        const preferred = choosePreferredPrinter(typedList);
        if (preferred) return preferred;
      }
    }

    if (typeof qz.printers.getDefault === "function") {
      const defaultPrinter = await qz.printers.getDefault();
      if (defaultPrinter?.trim()) return defaultPrinter.trim();
    }

    const discovered = await qz.printers.find();
    const discoveredList = typeof discovered === "string" ? [discovered] : discovered;
    const resolved = choosePreferredPrinter(discoveredList ?? []);
    if (resolved) return resolved;
    throw new Error("Nenhuma impressora encontrada pelo QZ Tray.");
  }, []);

  const printOrderViaQz = useCallback(async (order: AdminOrder) => {
    setQzBusy(true);
    setQzError("");
    try {
      const qz = await loadQz();
      await configureQzSecurity(qz);
      if (!qz.websocket.isActive()) {
        await qz.websocket.connect({ retries: 2, delay: 1 });
      }
      setQzConnectionState("connected");

      const printerName = await resolveQzPrinter(qz);
      const config = qz.configs.create(printerName, { encoding: "ISO-8859-1", copies: 1 });
      const activeLayout = readActivePrintLayout();
      const sendRawTicket = async (ticket: string) => {
        await qz.print(config, [{ type: "raw", format: "command", flavor: "plain", data: ticket }]);
      };

      try {
        const ticket = await buildEscPosTicket(order, activeLayout);
        await sendRawTicket(ticket);
      } catch {
        const fallbackLayout: PrintLayout = {
          ...activeLayout,
          blocks: activeLayout.blocks.map((block) => ({
            ...block,
            size: "normal",
            leftSize: "normal",
            rightSize: "normal",
          })),
        };
        const fallbackTicket = await buildEscPosTicket(order, fallbackLayout);
        try {
          await sendRawTicket(fallbackTicket);
        } catch {
          const emergencyTicket =
            "\x1B\x40" +
            "=== PEDIDO ===\n" +
            `${toLatin1Safe(order.code)}\n` +
            `${toLatin1Safe(order.customerName || "Cliente nao informado")}\n` +
            `${toLatin1Safe(formatBRLPrint(order.subtotal))}\n\n\n` +
            "\x1D\x56\x41\x10";
          await sendRawTicket(emergencyTicket);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao imprimir via QZ Tray.";
      setQzError(message);
      setQzConnectionState("disconnected");
    } finally {
      setQzBusy(false);
    }
  }, [configureQzSecurity, loadQz, resolveQzPrinter]);

  // Polling de 2s para detectar desconexão do QZ Tray na janela
  useEffect(() => {
    const refresh = () => {
      try {
        setQzConnectionState(window.qz?.websocket.isActive() ? "connected" : "disconnected");
      } catch {
        setQzConnectionState("disconnected");
      }
    };
    refresh();
    const interval = window.setInterval(refresh, 2000);
    return () => window.clearInterval(interval);
  }, []);

  return { qzConnectionState, qzBusy, qzError, setQzError, printOrderViaQz };
}
