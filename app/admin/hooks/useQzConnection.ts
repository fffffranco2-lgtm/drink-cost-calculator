"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  QZ_PRINTER_STORAGE_KEY,
  type QzApi,
  type QzConnectionState,
  type QzTextSizePreset,
} from "@/lib/qz-tray";
import { choosePreferredPrinter } from "@/lib/utils";

/* ---------- helpers internos de ESC/POS para o teste de impressão ---------- */

const QZ_TEST_SIZE_TO_SCALE: Record<QzTextSizePreset, number> = {
  normal: 1,
  "2x": 2,
  "3x": 3,
};

const QZ_TEST_SIZE_TO_ESC_POS: Record<QzTextSizePreset, string> = {
  normal: "\x1D\x21\x00",
  "2x": "\x1D\x21\x11",
  "3x": "\x1D\x21\x22",
};

function qzTestColumnsForSize(baseWidth: number, preset: QzTextSizePreset) {
  return Math.max(8, Math.floor(baseWidth / QZ_TEST_SIZE_TO_SCALE[preset]));
}

function qzTestCenterLine(text: string, width: number) {
  const safe = text.trim();
  if (safe.length >= width) return safe.slice(0, width);
  const leftPadding = Math.floor((width - safe.length) / 2);
  return `${" ".repeat(leftPadding)}${safe}`;
}

function qzTestLeftRightLine(left: string, right: string, width: number) {
  const safeLeft = left.trim();
  const safeRight = right.trim();
  const maxLeftLen = Math.max(0, width - safeRight.length - 1);
  const croppedLeft = safeLeft.length > maxLeftLen ? safeLeft.slice(0, maxLeftLen) : safeLeft;
  const spaces = Math.max(1, width - croppedLeft.length - safeRight.length);
  return `${croppedLeft}${" ".repeat(spaces)}${safeRight}`;
}

/* ---------- hook público ---------- */

export type UseQzConnectionResult = {
  qzConnectionState: QzConnectionState;
  qzPrinterName: string;
  setQzPrinterName: (name: string) => void;
  qzBusy: boolean;
  qzError: string;
  connectQz: () => Promise<void>;
  printStyledTestViaQz: () => Promise<void>;
  resolveSelectedQzPrinter: (qz: QzApi) => Promise<string>;
};

/**
 * Encapsula toda a lógica de conexão e impressão via QZ Tray:
 * - carregamento dinâmico do script qz-tray.js (CDN + fallback local)
 * - configuração de certificado e assinatura
 * - estado de conexão com polling a cada 2s
 * - persistência do nome da impressora preferida no localStorage
 */
export function useQzConnection(): UseQzConnectionResult {
  const [qzConnectionState, setQzConnectionState] = useState<QzConnectionState>("disconnected");
  const [qzPrinterName, setQzPrinterName] = useState("");
  const [qzBusy, setQzBusy] = useState(false);
  const [qzError, setQzError] = useState("");

  const qzLoaderRef = useRef<Promise<QzApi> | null>(null);
  const qzSecurityReadyRef = useRef(false);

  /* ---- carrega qz-tray.js dinamicamente ---- */
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

  /* ---- configura certificado e assinatura ---- */
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

  /* ---- polling de estado da conexão ---- */
  const refreshQzWindowConnection = useCallback(() => {
    try {
      setQzConnectionState(window.qz?.websocket.isActive() ? "connected" : "disconnected");
    } catch {
      setQzConnectionState("disconnected");
    }
  }, []);

  /* ---- resolve impressora preferida ---- */
  const resolveSelectedQzPrinter = useCallback(async (qz: QzApi) => {
    const typedName = qzPrinterName.trim();
    if (typedName) {
      const typedFound = await qz.printers.find(typedName);
      const typedList = typeof typedFound === "string" ? [typedFound] : typedFound;
      const exact = (typedList ?? []).find((name) => name.trim().toLowerCase() === typedName.toLowerCase());
      const fallbackTyped = choosePreferredPrinter(typedList ?? []);
      const resolvedTyped = (exact ?? fallbackTyped ?? "").trim();
      if (resolvedTyped) return resolvedTyped;
    }

    if (typeof qz.printers.getDefault === "function") {
      const defaultPrinter = (await qz.printers.getDefault())?.trim() ?? "";
      if (defaultPrinter) return defaultPrinter;
    }

    const discovered = await qz.printers.find();
    const list = typeof discovered === "string" ? [discovered] : discovered;
    const resolved = choosePreferredPrinter(list ?? []);
    if (!resolved) throw new Error("Nenhuma impressora encontrada pelo QZ Tray.");
    return resolved;
  }, [qzPrinterName]);

  /* ---- conecta ao QZ Tray ---- */
  const connectQz = useCallback(async () => {
    setQzBusy(true);
    setQzError("");
    try {
      const qz = await loadQz();
      await configureQzSecurity(qz);
      if (!qz.websocket.isActive()) {
        await qz.websocket.connect({ retries: 2, delay: 1 });
      }
      setQzConnectionState("connected");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao conectar com QZ Tray.";
      setQzError(`${message} Inicie o QZ Tray e permita a conexão do site.`);
      setQzConnectionState("disconnected");
    } finally {
      setQzBusy(false);
    }
  }, [configureQzSecurity, loadQz]);

  /* ---- teste de impressão avançado ESC/POS ---- */
  const printStyledTestViaQz = useCallback(async () => {
    setQzBusy(true);
    setQzError("");
    try {
      const qz = await loadQz();
      await configureQzSecurity(qz);
      if (!qz.websocket.isActive()) {
        await qz.websocket.connect({ retries: 2, delay: 1 });
      }
      const resolved = await resolveSelectedQzPrinter(qz);
      const config = qz.configs.create(resolved, { encoding: "ISO-8859-1", copies: 1 });
      const width = 32;
      const nl = "\n";
      const now = new Date().toLocaleString("pt-BR");
      const totalText = "R$ 123,45";
      const out: string[] = [];
      out.push("\x1B\x40");

      out.push("\x1B\x45\x01");
      out.push("\x1B\x61\x01");
      out.push(QZ_TEST_SIZE_TO_ESC_POS["2x"]);
      const titleWidth = qzTestColumnsForSize(width, "2x");
      out.push(`${qzTestCenterLine("TESTE AVANCADO", titleWidth)}\n`);
      out.push(`${qzTestCenterLine("QZ + ESC/POS", titleWidth)}\n`);
      out.push(QZ_TEST_SIZE_TO_ESC_POS.normal);
      out.push("\x1B\x45\x00");
      out.push("\x1B\x61\x00");
      out.push(`${"=".repeat(width)}${nl}`);
      out.push(`Data: ${now}${nl}`);
      out.push(`Titulo: 2X${nl}`);
      out.push(`Total: 2X${nl}`);
      out.push(`${"-".repeat(width)}${nl}`);
      out.push(`Item de teste${nl}`);
      out.push(`${qzTestLeftRightLine("1 x R$ 123,45", "R$ 123,45", width)}${nl}`);
      out.push(`${"=".repeat(width)}${nl}`);
      out.push("\x1B\x45\x01");
      out.push(QZ_TEST_SIZE_TO_ESC_POS["2x"]);
      const totalWidth = qzTestColumnsForSize(width, "2x");
      out.push(`${qzTestLeftRightLine("TOTAL", totalText, totalWidth)}${nl}`);
      out.push(QZ_TEST_SIZE_TO_ESC_POS.normal);
      out.push("\x1B\x45\x00");
      out.push(`${nl}${nl}`);
      out.push("\x1D\x56\x41\x10");
      const sample = out.join("");
      await qz.print(config, [{ type: "raw", format: "command", flavor: "plain", data: sample }]);
      setQzConnectionState("connected");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao testar impressão avançada via QZ Tray.";
      setQzError(message);
      setQzConnectionState("disconnected");
    } finally {
      setQzBusy(false);
    }
  }, [configureQzSecurity, loadQz, resolveSelectedQzPrinter]);

  /* ---- effects ---- */

  // carrega impressora salva no localStorage
  useEffect(() => {
    try {
      const savedPrinter = localStorage.getItem(QZ_PRINTER_STORAGE_KEY);
      if (savedPrinter) setQzPrinterName(savedPrinter);
    } catch {
      // ignora indisponibilidade de storage
    }
  }, []);

  // persiste nome da impressora ao mudar
  useEffect(() => {
    try {
      localStorage.setItem(QZ_PRINTER_STORAGE_KEY, qzPrinterName);
    } catch {
      // ignora indisponibilidade de storage
    }
  }, [qzPrinterName]);

  // polling de estado da conexão a cada 2s
  useEffect(() => {
    refreshQzWindowConnection();
    const interval = window.setInterval(refreshQzWindowConnection, 2000);
    return () => window.clearInterval(interval);
  }, [refreshQzWindowConnection]);

  return {
    qzConnectionState,
    qzPrinterName,
    setQzPrinterName,
    qzBusy,
    qzError,
    connectQz,
    printStyledTestViaQz,
    resolveSelectedQzPrinter,
  };
}
