"use client";

import { useCallback } from "react";
import type { QzApi, QzConnectionState, QzTextSizePreset } from "@/lib/qz-tray";
import {
  useQzBase,
  useQzPrinterName,
  resolvePrinter,
} from "@/lib/qz-core";

/**
 * Hook para a tela de Settings: conecta e executa um teste ESC/POS rico.
 * Mantém assinatura compatível com o antigo useQzConnection.
 */

const QZ_TEST_SIZE_TO_SCALE: Record<QzTextSizePreset, number> = { normal: 1, "2x": 2, "3x": 3 };
const QZ_TEST_SIZE_TO_ESC_POS: Record<QzTextSizePreset, string> = {
  normal: "\x1D\x21\x00",
  "2x": "\x1D\x21\x11",
  "3x": "\x1D\x21\x22",
};

function cols(baseWidth: number, preset: QzTextSizePreset) {
  return Math.max(8, Math.floor(baseWidth / QZ_TEST_SIZE_TO_SCALE[preset]));
}
function center(text: string, width: number) {
  const safe = text.trim();
  if (safe.length >= width) return safe.slice(0, width);
  return `${" ".repeat(Math.floor((width - safe.length) / 2))}${safe}`;
}
function leftRight(left: string, right: string, width: number) {
  const l = left.trim();
  const r = right.trim();
  const maxL = Math.max(0, width - r.length - 1);
  const cropped = l.length > maxL ? l.slice(0, maxL) : l;
  const spaces = Math.max(1, width - cropped.length - r.length);
  return `${cropped}${" ".repeat(spaces)}${r}`;
}

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

export function useQzConnection(): UseQzConnectionResult {
  const [qzPrinterName, setQzPrinterName] = useQzPrinterName();
  const { qzConnectionState, qzBusy, qzError, runWithQz } = useQzBase();

  const resolveSelectedQzPrinter = useCallback(
    (qz: QzApi) => resolvePrinter(qz, qzPrinterName),
    [qzPrinterName]
  );

  const connectQz = useCallback(async () => {
    await runWithQz(async () => undefined);
  }, [runWithQz]);

  const printStyledTestViaQz = useCallback(async () => {
    await runWithQz(async (qz) => {
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
      const tw = cols(width, "2x");
      out.push(`${center("TESTE AVANCADO", tw)}\n`);
      out.push(`${center("QZ + ESC/POS", tw)}\n`);
      out.push(QZ_TEST_SIZE_TO_ESC_POS.normal);
      out.push("\x1B\x45\x00");
      out.push("\x1B\x61\x00");
      out.push(`${"=".repeat(width)}${nl}`);
      out.push(`Data: ${now}${nl}`);
      out.push(`Titulo: 2X${nl}`);
      out.push(`Total: 2X${nl}`);
      out.push(`${"-".repeat(width)}${nl}`);
      out.push(`Item de teste${nl}`);
      out.push(`${leftRight("1 x R$ 123,45", "R$ 123,45", width)}${nl}`);
      out.push(`${"=".repeat(width)}${nl}`);
      out.push("\x1B\x45\x01");
      out.push(QZ_TEST_SIZE_TO_ESC_POS["2x"]);
      out.push(`${leftRight("TOTAL", totalText, cols(width, "2x"))}${nl}`);
      out.push(QZ_TEST_SIZE_TO_ESC_POS.normal);
      out.push("\x1B\x45\x00");
      out.push(`${nl}${nl}`);
      out.push("\x1D\x56\x41\x10");
      await qz.print(config, [{ type: "raw", format: "command", flavor: "plain", data: out.join("") }]);
    });
  }, [runWithQz, resolveSelectedQzPrinter]);

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
