"use client";

import { useCallback } from "react";
import { useQzBase, resolvePrinter } from "@/lib/qz-core";

export type UseImpressaoQzConnectionResult = {
  testPrintBusy: boolean;
  testPrintError: string;
  setTestPrintError: (msg: string) => void;
  printWithQz: (ticket: string) => Promise<void>;
};

/**
 * Hook para a tela de Impressão (editor de blocos): envia um ticket bruto
 * já formatado (ESC/POS) para a impressora resolvida.
 */
export function useImpressaoQzConnection(): UseImpressaoQzConnectionResult {
  const { qzBusy, qzError, setQzError, runWithQz } = useQzBase({ pollConnection: false });

  const printWithQz = useCallback(
    async (ticket: string) => {
      await runWithQz(async (qz) => {
        const printerName = await resolvePrinter(qz);
        const config = qz.configs.create(printerName, { encoding: "ISO-8859-1", copies: 1 });
        await qz.print(config, [{ type: "raw", format: "command", flavor: "plain", data: ticket }]);
      });
    },
    [runWithQz]
  );

  return {
    testPrintBusy: qzBusy,
    testPrintError: qzError,
    setTestPrintError: setQzError,
    printWithQz,
  };
}
