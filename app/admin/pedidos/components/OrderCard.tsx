"use client";

import React from "react";
import { formatBRL } from "@/lib/utils";
import { type AdminOrder, type OrderStatus } from "@/lib/orders";

const FONT_SCALE = { sm: 12, md: 14, lg: 20 } as const;

export type OrderCardProps = {
  order: AdminOrder;
  statusKey: OrderStatus;
  isDragging: boolean;
  isExpanded: boolean;
  qzBusy: boolean;
  btn: React.CSSProperties;
  small: React.CSSProperties;
  formatOrderDate: (iso: string) => string;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onToggle: () => void;
  onPrint: () => void;
};

export function OrderCard({
  order,
  statusKey,
  isDragging,
  isExpanded,
  qzBusy,
  btn,
  small,
  formatOrderDate,
  onDragStart,
  onDragEnd,
  onToggle,
  onPrint,
}: OrderCardProps) {
  const isCompletedCard = statusKey === "concluido";

  const statusCardBackground =
    statusKey === "pendente" ? "#fff1f1" : statusKey === "em_progresso" ? "#fff8df" : "#ecfdf3";
  const statusCardBorder =
    statusKey === "pendente" ? "#f2cccc" : statusKey === "em_progresso" ? "#eed9a7" : "#bfe8cf";
  const statusButtonBackground =
    statusKey === "pendente" ? "#fde2e2" : statusKey === "em_progresso" ? "#fdf0c4" : "#dcfce7";
  const statusButtonBorder =
    statusKey === "pendente" ? "#e9b9b9" : statusKey === "em_progresso" ? "#e8d08d" : "#a7d9bc";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={isCompletedCard ? onToggle : undefined}
      style={{
        border: `1px solid ${statusCardBorder}`,
        borderRadius: 10,
        padding: 9,
        background: statusCardBackground,
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.75 : 1,
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
              title="Imprimir via QZ"
              aria-label="Imprimir via QZ"
              style={{
                ...btn,
                width: 34,
                height: 34,
                padding: 0,
                borderRadius: 999,
                fontSize: FONT_SCALE.md,
                lineHeight: 1,
                background: statusButtonBackground,
                borderColor: statusButtonBorder,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              disabled={qzBusy}
              onClick={(e) => {
                e.stopPropagation();
                onPrint();
              }}
            >
              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>
                print
              </span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
