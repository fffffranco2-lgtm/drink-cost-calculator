"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QZ_PRINTER_STORAGE_KEY, type QzApi, type QzConnectionState } from "@/lib/qz-tray";
import { choosePreferredPrinter } from "@/lib/utils";

/**
 * Core QZ Tray: carregamento dinâmico do script, configuração de
 * certificado/assinatura, resolução de impressora e um hook base
 * reutilizável entre as telas.
 *
 * Substitui os 3 hooks duplicados (useQzConnection, useImpressaoQzConnection,
 * usePedidosQzConnection) mantendo APIs compatíveis por meio de wrappers finos.
 */

/* ---------------------------- script loader ---------------------------- */

let qzLoaderPromise: Promise<QzApi> | null = null;

const QZ_SCRIPT_SOURCES = [
  "https://cdn.jsdelivr.net/npm/qz-tray@2.2.5/qz-tray.js",
  "https://unpkg.com/qz-tray@2.2.5/qz-tray.js",
  "https://localhost:8181/qz-tray.js",
  "http://localhost:8181/qz-tray.js",
  "https://localhost:8182/qz-tray.js",
  "http://localhost:8182/qz-tray.js",
];

export function loadQz(): Promise<QzApi> {
  if (typeof window !== "undefined" && window.qz) return Promise.resolve(window.qz);
  if (qzLoaderPromise) return qzLoaderPromise;

  qzLoaderPromise = new Promise<QzApi>((resolve, reject) => {
    const tryLoad = (index: number) => {
      if (typeof window !== "undefined" && window.qz) return resolve(window.qz);
      if (index >= QZ_SCRIPT_SOURCES.length) {
        return reject(new Error("Não foi possível carregar qz-tray.js (CDN e localhost 8181/8182)."));
      }
      const script = document.createElement("script");
      script.src = QZ_SCRIPT_SOURCES[index];
      script.async = true;
      script.onload = () => (window.qz ? resolve(window.qz) : tryLoad(index + 1));
      script.onerror = () => {
        script.remove();
        tryLoad(index + 1);
      };
      document.head.appendChild(script);
    };
    tryLoad(0);
  }).catch((error) => {
    qzLoaderPromise = null;
    throw error;
  });

  return qzLoaderPromise;
}

/* ---------------------------- security setup ---------------------------- */

let qzSecurityReady = false;

export async function configureQzSecurity(qz: QzApi): Promise<void> {
  if (qzSecurityReady) return;
  if (!qz.security?.setCertificatePromise || !qz.security?.setSignaturePromise) {
    throw new Error("API de segurança do QZ Tray indisponível.");
  }

  const certRes = await fetch("/api/qz/certificate", { cache: "no-store" });
  const certText = await certRes.text();
  if (!certRes.ok) throw new Error(certText || "Falha ao carregar certificado QZ.");
  const certificate = certText.trim();
  if (!certificate) throw new Error("Certificado QZ vazio.");

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

  qzSecurityReady = true;
}

/* ---------------------------- printer resolver ---------------------------- */

/**
 * Resolve qual impressora usar.
 *  - Se `typedName` for passado (ou estiver no localStorage), tenta match exato primeiro,
 *    depois fallback preferido dentro do grupo.
 *  - Caso contrário, usa a impressora padrão do sistema.
 *  - Por último, escolhe a preferida entre todas as descobertas.
 */
export async function resolvePrinter(qz: QzApi, typedNameOverride?: string): Promise<string> {
  let typedName = typedNameOverride?.trim() ?? "";
  if (!typedName && typeof window !== "undefined") {
    try {
      typedName = (localStorage.getItem(QZ_PRINTER_STORAGE_KEY) ?? "").trim();
    } catch {
      // ignora indisponibilidade
    }
  }

  if (typedName) {
    const typedFound = await qz.printers.find(typedName);
    const typedList = typeof typedFound === "string" ? [typedFound] : typedFound;
    if (Array.isArray(typedList)) {
      const exact = typedList.find((n) => n.trim().toLowerCase() === typedName.toLowerCase());
      if (exact?.trim()) return exact.trim();
      const preferred = choosePreferredPrinter(typedList);
      if (preferred) return preferred;
    }
  }

  if (typeof qz.printers.getDefault === "function") {
    const defaultPrinter = (await qz.printers.getDefault())?.trim();
    if (defaultPrinter) return defaultPrinter;
  }

  const discovered = await qz.printers.find();
  const list = typeof discovered === "string" ? [discovered] : discovered;
  const resolved = choosePreferredPrinter(list ?? []);
  if (!resolved) throw new Error("Nenhuma impressora encontrada pelo QZ Tray.");
  return resolved;
}

/* ---------------------------- connection helper ---------------------------- */

export async function ensureQzReady(): Promise<QzApi> {
  const qz = await loadQz();
  await configureQzSecurity(qz);
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect({ retries: 2, delay: 1 });
  }
  return qz;
}

/* ---------------------------- base hook ---------------------------- */

export type UseQzBaseOptions = {
  /** Se true, faz polling de 2s para detectar desconexão. Default: true */
  pollConnection?: boolean;
};

export type UseQzBaseResult = {
  qzConnectionState: QzConnectionState;
  qzBusy: boolean;
  qzError: string;
  setQzError: (msg: string) => void;
  /** Carrega QZ, configura segurança e garante websocket aberto. */
  ensureReady: () => Promise<QzApi>;
  /** Executa uma operação envolta em busy/error management. */
  runWithQz: <T>(fn: (qz: QzApi) => Promise<T>) => Promise<T | undefined>;
};

export function useQzBase(options: UseQzBaseOptions = {}): UseQzBaseResult {
  const { pollConnection = true } = options;

  const [qzConnectionState, setQzConnectionState] = useState<QzConnectionState>("disconnected");
  const [qzBusy, setQzBusy] = useState(false);
  const [qzError, setQzError] = useState("");

  const ensureReady = useCallback(async () => {
    const qz = await ensureQzReady();
    setQzConnectionState("connected");
    return qz;
  }, []);

  const runWithQz = useCallback(
    async <T,>(fn: (qz: QzApi) => Promise<T>): Promise<T | undefined> => {
      setQzBusy(true);
      setQzError("");
      try {
        const qz = await ensureReady();
        const result = await fn(qz);
        setQzConnectionState("connected");
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha na operação do QZ Tray.";
        setQzError(message);
        setQzConnectionState("disconnected");
        return undefined;
      } finally {
        setQzBusy(false);
      }
    },
    [ensureReady]
  );

  useEffect(() => {
    if (!pollConnection) return;
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
  }, [pollConnection]);

  return { qzConnectionState, qzBusy, qzError, setQzError, ensureReady, runWithQz };
}

/* ---------------------------- printer name persistence ---------------------------- */

export function useQzPrinterName(): [string, (name: string) => void] {
  const [qzPrinterName, setQzPrinterName] = useState("");
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(QZ_PRINTER_STORAGE_KEY);
      if (saved) setQzPrinterName(saved);
    } catch {
      // ignora
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(QZ_PRINTER_STORAGE_KEY, qzPrinterName);
    } catch {
      // ignora
    }
  }, [qzPrinterName]);

  return [qzPrinterName, setQzPrinterName];
}
