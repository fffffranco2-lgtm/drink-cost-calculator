"use client";

import { useCallback, useRef, useState } from "react";
import { QZ_PRINTER_STORAGE_KEY, type QzApi } from "@/lib/qz-tray";

export type UseImpressaoQzConnectionResult = {
  testPrintBusy: boolean;
  testPrintError: string;
  setTestPrintError: (msg: string) => void;
  printWithQz: (ticket: string) => Promise<void>;
};

export function useImpressaoQzConnection(): UseImpressaoQzConnectionResult {
  const [testPrintBusy, setTestPrintBusy] = useState(false);
  const [testPrintError, setTestPrintError] = useState("");
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
        if (window.qz) return resolve(window.qz);
        if (index >= scriptSources.length) return reject(new Error("Não foi possível carregar qz-tray.js."));
        const script = document.createElement("script");
        script.src = scriptSources[index];
        script.async = true;
        script.onload = () => (window.qz ? resolve(window.qz) : tryLoad(index + 1));
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
      if (!signRes.ok || !payload.signature) throw new Error(payload.error ?? "Falha ao assinar requisição QZ.");
      return payload.signature;
    });
    qzSecurityReadyRef.current = true;
  }, []);

  const resolveQzPrinter = useCallback(async (qz: QzApi) => {
    const typedName = (localStorage.getItem(QZ_PRINTER_STORAGE_KEY) ?? "").trim();
    if (typedName) {
      const typedFound = await qz.printers.find(typedName);
      const typedList = typeof typedFound === "string" ? [typedFound] : typedFound;
      const exact = typedList?.find((name) => name.trim().toLowerCase() === typedName.toLowerCase());
      if (exact?.trim()) return exact.trim();
    }
    if (typeof qz.printers.getDefault === "function") {
      const defaultPrinter = await qz.printers.getDefault();
      if (defaultPrinter?.trim()) return defaultPrinter.trim();
    }
    const listRaw = await qz.printers.find();
    const list = typeof listRaw === "string" ? [listRaw] : listRaw;
    const found = list?.map((name) => name.trim()).find(Boolean);
    if (!found) throw new Error("Nenhuma impressora encontrada no QZ.");
    return found;
  }, []);

  const printWithQz = useCallback(async (ticket: string) => {
    setTestPrintBusy(true);
    setTestPrintError("");
    try {
      const qz = await loadQz();
      await configureQzSecurity(qz);
      if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 2, delay: 1 });
      const printerName = await resolveQzPrinter(qz);
      const config = qz.configs.create(printerName, { encoding: "ISO-8859-1", copies: 1 });
      await qz.print(config, [{ type: "raw", format: "command", flavor: "plain", data: ticket }]);
    } catch (error) {
      setTestPrintError(error instanceof Error ? error.message : "Falha na impressão via QZ Tray.");
    } finally {
      setTestPrintBusy(false);
    }
  }, [configureQzSecurity, loadQz, resolveQzPrinter]);

  return { testPrintBusy, testPrintError, setTestPrintError, printWithQz };
}
