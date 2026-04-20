"use client";

import { useCallback } from "react";
import type { QzConnectionState } from "@/lib/qz-tray";
import { useQzBase, resolvePrinter } from "@/lib/qz-core";
import { toLatin1Safe } from "@/lib/escpos";
import { type PrintLayout } from "@/lib/print-layouts";
import { type AdminOrder } from "@/lib/orders";
import {
  buildEscPosTicket,
  formatBRLPrint,
  readActivePrintLayout,
} from "@/app/admin/pedidos/pedidos-print";

export type UsePedidosQzConnectionResult = {
  qzConnectionState: QzConnectionState;
  qzBusy: boolean;
  qzError: string;
  setQzError: (msg: string) => void;
  printOrderViaQz: (order: AdminOrder) => Promise<void>;
};

/**
 * Hook para a tela de Pedidos: monta um ticket ESC/POS a partir do layout
 * ativo e envia para a impressora. Possui 2 fallbacks progressivos para
 * garantir que algo sempre saia impresso.
 */
export function usePedidosQzConnection(): UsePedidosQzConnectionResult {
  const { qzConnectionState, qzBusy, qzError, setQzError, runWithQz } = useQzBase();

  const printOrderViaQz = useCallback(
    async (order: AdminOrder) => {
      await runWithQz(async (qz) => {
        const printerName = await resolvePrinter(qz);
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
      });
    },
    [runWithQz]
  );

  return {
    qzConnectionState,
    qzBusy,
    qzError,
    setQzError,
    printOrderViaQz,
  };
}
