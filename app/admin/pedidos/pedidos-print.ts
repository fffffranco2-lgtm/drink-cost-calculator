/**
 * Utilitários de impressão ESC/POS para a página de pedidos.
 * Todas as funções aqui são puras (sem estado React).
 */

import { type QzTextSizePreset } from "@/lib/qz-tray";
import {
  DEFAULT_LAYOUT_LOGO_PATH,
  defaultPrintLayout,
  getLayoutsFromStorage,
  resolveActiveLayout,
  QZ_ACTIVE_LAYOUT_STORAGE_KEY,
  type PrintAlign,
  type PrintDataKey,
  type PrintItemTemplateRow,
  type PrintLayout,
  type PrintLayoutBlock,
} from "@/lib/print-layouts";
import { type AdminOrder, type AdminOrderItem } from "@/lib/orders";
import {
  buildEscPosRasterLogo,
  columnsForSize,
  fitPresetToContent,
  leftRightLine,
  toLatin1Safe,
  wrapText,
} from "@/lib/escpos";

export const ORDERS_QZ_ACTIVE_LAYOUT_STORAGE_KEY = "orders_page_qz_active_layout_id";
const ESC_POS_LINE_WIDTH = 32;

const QZ_SIZE_TO_ESC_POS: Record<QzTextSizePreset, string> = {
  normal: "\x1D\x21\x00",
  "2x": "\x1D\x21\x11",
  "3x": "\x1D\x21\x22",
};

type ComposeElementKind = "customer" | "items" | "items_count" | "total";
const COMPOSE_DEFAULTS: Record<ComposeElementKind, { left: string[]; right: string[] }> = {
  customer: { left: ["customer_name"], right: ["customer_phone"] },
  items: { left: ["item_qty_price"], right: ["item_total"] },
  items_count: { left: ["items_label"], right: ["items_count"] },
  total: { left: ["total_label"], right: ["total_value"] },
};

export function formatBRLPrint(value: number) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const [rawInt, cents] = abs.toFixed(2).split(".");
  const groupedInt = rawInt.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${groupedInt},${cents}`;
}

function effectiveComposeParts(block: PrintLayoutBlock, kind: ComposeElementKind) {
  const defaults = COMPOSE_DEFAULTS[kind];
  const left = Array.isArray(block.composeLeft) && block.composeLeft.length ? block.composeLeft : defaults.left;
  const right = Array.isArray(block.composeRight) && block.composeRight.length ? block.composeRight : defaults.right;
  return { left, right };
}

function rowColumnSettingsFromRow(row: PrintItemTemplateRow) {
  return {
    leftAlign: row.leftAlign ?? row.align ?? "left",
    rightAlign: row.rightAlign ?? (row.align === "center" ? "center" : "right"),
    leftSize: row.leftSize ?? row.size ?? "normal",
    rightSize: row.rightSize ?? row.size ?? "normal",
    leftBold: row.leftBold ?? row.bold ?? false,
    rightBold: row.rightBold ?? row.bold ?? false,
  } as const;
}

function itemTemplateRows(block: PrintLayoutBlock): PrintItemTemplateRow[] {
  if (Array.isArray(block.itemRows) && block.itemRows.length) return block.itemRows;
  if (block.leftDataKey || block.rightDataKey) {
    return [
      {
        id: `${block.id}_itemrow_0`,
        leftDataKey: block.leftDataKey ?? "item_qty_price",
        rightDataKey: block.rightDataKey ?? "item_total",
        leftText: block.leftText,
        rightText: block.rightText,
        leftAlign: block.leftAlign ?? block.align ?? "left",
        rightAlign: block.rightAlign ?? (block.align === "center" ? "center" : "right"),
        leftSize: block.leftSize ?? block.size ?? "normal",
        rightSize: block.rightSize ?? block.size ?? "normal",
        leftBold: block.leftBold ?? block.bold ?? false,
        rightBold: block.rightBold ?? block.bold ?? false,
      },
    ];
  }
  return [
    {
      id: `${block.id}_itemrow_0`,
      dataKey: isItemDataKey(block.dataKey) ? block.dataKey : "item_name",
      text: block.text,
      align: block.align ?? "left",
      size: block.size ?? "normal",
      bold: block.bold ?? false,
    },
  ];
}

function composeFromParts(parts: string[], values: Record<string, string>) {
  return parts
    .map((part) => values[part] ?? "")
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemHasNotes(item: AdminOrderItem) {
  const raw = item.drinkNotes ?? item.itemNotes ?? item.notes ?? "";
  return Boolean(raw.trim());
}

function isItemDataKey(key?: PrintDataKey) {
  return Boolean(key && key.startsWith("item_"));
}

function centerLine(text: string, width: number) {
  const safe = text.trim();
  if (safe.length >= width) return safe.slice(0, width);
  const leftPadding = Math.floor((width - safe.length) / 2);
  return `${" ".repeat(leftPadding)}${safe}`;
}

function alignLine(text: string, width: number, align: PrintAlign) {
  const safe = text.trim();
  if (align === "right") {
    if (safe.length >= width) return safe.slice(0, width);
    return `${" ".repeat(width - safe.length)}${safe}`;
  }
  if (align === "center") return centerLine(safe, width);
  if (safe.length >= width) return safe.slice(0, width);
  return safe;
}

function fitTextToColumns(text: string, maxColumns: number, align: PrintAlign) {
  const safe = text.replace(/\s+/g, " ").trim();
  const clipped = Array.from(safe).slice(0, Math.max(0, maxColumns)).join("");
  const used = clipped.length;
  const spaces = Math.max(0, maxColumns - used);
  if (align === "right") return `${" ".repeat(spaces)}${clipped}`;
  if (align === "center") {
    const leftPadding = Math.floor(spaces / 2);
    const rightPadding = spaces - leftPadding;
    return `${" ".repeat(leftPadding)}${clipped}${" ".repeat(rightPadding)}`;
  }
  return `${clipped}${" ".repeat(spaces)}`;
}

function twoColumnLine(left: string, right: string, width: number, leftAlign: PrintAlign, rightAlign: PrintAlign) {
  const leftWidth = Math.max(1, Math.floor(width / 2));
  const rightWidth = Math.max(1, width - leftWidth);
  return `${fitTextToColumns(left, leftWidth, leftAlign)}${fitTextToColumns(right, rightWidth, rightAlign)}`;
}

function glyphColumnWidth(char: string) {
  const code = char.codePointAt(0) ?? 0;
  if (!code) return 1;
  if (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6))
  ) {
    return 2;
  }
  return 1;
}

function separatorLine(charInput: string | undefined, width: number) {
  const char = Array.from(charInput?.trim() || "")[0] || "-";
  const charWidth = Math.max(1, glyphColumnWidth(char));
  const repeatCount = Math.max(1, Math.floor(width / charWidth));
  return char.repeat(repeatCount);
}

function escPosAlignCommand(align: PrintAlign) {
  if (align === "center") return "\x1B\x61\x01";
  if (align === "right") return "\x1B\x61\x02";
  return "\x1B\x61\x00";
}

export function readActivePrintLayout(): PrintLayout {
  try {
    const layouts = getLayoutsFromStorage();
    const activeLayoutId =
      localStorage.getItem(ORDERS_QZ_ACTIVE_LAYOUT_STORAGE_KEY)?.trim() ||
      localStorage.getItem(QZ_ACTIVE_LAYOUT_STORAGE_KEY)?.trim() ||
      defaultPrintLayout().id;
    return resolveActiveLayout(layouts, activeLayoutId);
  } catch {
    return defaultPrintLayout();
  }
}

export async function buildEscPosTicket(order: AdminOrder, layout: PrintLayout) {
  const width = ESC_POS_LINE_WIDTH;
  const nl = "\n";
  const sourceText = order.source === "mesa_qr" && order.tableCode ? `Mesa ${order.tableCode}` : "Balcao";
  const customerName = order.customerName || "Cliente nao informado";
  const phone = order.customerPhone ? order.customerPhone : "";
  const createdAt = new Date(order.createdAt).toLocaleString("pt-BR");
  const totalText = toLatin1Safe(formatBRLPrint(order.subtotal));
  const itemsCountText = String(order.items.reduce((acc, item) => acc + item.qty, 0));

  const out: string[] = ["\x00", "\x1B\x61\x00", QZ_SIZE_TO_ESC_POS.normal, "\x1B\x45\x00"];

  const orderFieldValue = (key: PrintDataKey, block: PrintLayoutBlock) => {
    if (key === "code") return toLatin1Safe(order.code);
    if (key === "datetime") return toLatin1Safe(createdAt);
    if (key === "source") return toLatin1Safe(sourceText);
    if (key === "customer_name") return toLatin1Safe(customerName);
    if (key === "customer_phone") return toLatin1Safe(phone);
    if (key === "items_label") return "ITENS";
    if (key === "items_count") return itemsCountText;
    if (key === "total_label") return toLatin1Safe(block.text?.trim() || "TOTAL");
    if (key === "total_value") return totalText;
    if (key === "order_notes") return toLatin1Safe(order.notes ?? "");
    return "";
  };

  const itemFieldValue = (key: PrintDataKey, item: AdminOrderItem) => {
    if (key === "item_name") return toLatin1Safe(item.drinkName);
    if (key === "item_qty") return toLatin1Safe(String(item.qty));
    if (key === "item_unit_price") return toLatin1Safe(formatBRLPrint(item.unitPrice));
    if (key === "item_qty_price") return toLatin1Safe(`${item.qty} x ${formatBRLPrint(item.unitPrice)}`);
    if (key === "item_total") return toLatin1Safe(formatBRLPrint(item.lineTotal));
    if (key === "item_notes") return toLatin1Safe(item.drinkNotes ?? item.itemNotes ?? item.notes ?? "");
    return "";
  };

  const printTextBlock = (
    block: PrintLayoutBlock,
    text: string,
    defaults?: { align?: PrintAlign; size?: QzTextSizePreset; bold?: boolean; allowWrap?: boolean }
  ) => {
    const align = block.align ?? defaults?.align ?? "left";
    const allowWrap = defaults?.allowWrap ?? false;
    const normalizedText = toLatin1Safe(text).replace(/\s*\r?\n\s*/g, " ").replace(/\s+/g, " ").trim();
    const rawSize = block.size ?? defaults?.size ?? "normal";
    const minColumns = allowWrap
      ? Math.max(...wrapText(normalizedText, width).map((line) => line.length), 1)
      : Math.max(normalizedText.length, 1);
    const size = fitPresetToContent(width, rawSize, minColumns);
    const blockWidth = columnsForSize(width, size);
    const bold = block.bold ?? defaults?.bold ?? false;
    out.push(escPosAlignCommand(align));
    out.push(QZ_SIZE_TO_ESC_POS[size]);
    out.push(bold ? "\x1B\x45\x01" : "\x1B\x45\x00");
    if (allowWrap) {
      for (const line of wrapText(normalizedText, blockWidth)) {
        out.push(`${alignLine(line, blockWidth, align)}${nl}`);
      }
    } else {
      out.push(`${alignLine(normalizedText, blockWidth, align)}${nl}`);
    }
    out.push("\x1B\x61\x00");
    out.push(QZ_SIZE_TO_ESC_POS.normal);
    out.push("\x1B\x45\x00");
  };

  for (const block of layout.blocks) {
    if (block.kind === "logo") {
      const logoPath = block.logoPath?.trim() || DEFAULT_LAYOUT_LOGO_PATH;
      try {
        out.push(await buildEscPosRasterLogo(logoPath));
        out.push(nl);
      } catch {
        // ignora erro de logo para não bloquear a impressão
      }
      continue;
    }
    if (block.kind === "blank") {
      out.push(nl);
      continue;
    }
    if (block.kind === "separator") {
      const align = block.align ?? "left";
      const size = block.size ?? "normal";
      const blockWidth = columnsForSize(width, size);
      const separator = separatorLine(block.separatorChar, blockWidth);
      out.push(escPosAlignCommand(align));
      out.push(QZ_SIZE_TO_ESC_POS[size]);
      out.push("\x1B\x45\x00");
      out.push(`${align === "left" ? separator : alignLine(separator, blockWidth, align)}${nl}`);
      out.push("\x1B\x61\x00");
      out.push(QZ_SIZE_TO_ESC_POS.normal);
      continue;
    }
    if (block.kind === "title") {
      printTextBlock(block, block.text?.trim() || "PEDIDO", { align: "center", size: block.size ?? "2x", bold: true });
      continue;
    }
    if (block.kind === "code") {
      printTextBlock(block, order.code, { align: "center", bold: true });
      continue;
    }
    if (block.kind === "datetime") {
      printTextBlock(block, createdAt);
      continue;
    }
    if (block.kind === "source") {
      printTextBlock(block, sourceText);
      continue;
    }
    if (block.kind === "data") {
      const dataKey = block.dataKey ?? "code";
      const align = block.align ?? "left";
      const size = block.size ?? "normal";
      const blockWidth = columnsForSize(width, size);
      const bold = block.bold ?? false;
      out.push(escPosAlignCommand(align));
      out.push(QZ_SIZE_TO_ESC_POS[size]);
      out.push(bold ? "\x1B\x45\x01" : "\x1B\x45\x00");
      if (isItemDataKey(dataKey)) {
        for (const [index, item] of order.items.entries()) {
          const text = itemFieldValue(dataKey, item);
          if (!text) continue;
          if (dataKey === "item_notes") {
            for (const line of wrapText(text, blockWidth)) {
              out.push(`${alignLine(line, blockWidth, align)}${nl}`);
            }
          } else {
            out.push(`${alignLine(text, blockWidth, align)}${nl}`);
            if (dataKey === "item_name" && index < order.items.length - 1 && !itemHasNotes(item)) {
              out.push(nl);
            }
          }
        }
      } else {
        const text = orderFieldValue(dataKey, block);
        if (text) {
          if (dataKey === "order_notes") {
            for (const line of wrapText(text, blockWidth)) {
              out.push(`${alignLine(line, blockWidth, align)}${nl}`);
            }
          } else {
            out.push(`${alignLine(text, blockWidth, align)}${nl}`);
          }
        }
      }
      out.push("\x1B\x61\x00");
      out.push(QZ_SIZE_TO_ESC_POS.normal);
      out.push("\x1B\x45\x00");
      continue;
    }
    if (block.kind === "row_2col") {
      const leftKey = block.leftDataKey ?? "items_label";
      const rightKey = block.rightDataKey ?? "items_count";
      const leftAlign = block.leftAlign ?? block.align ?? "left";
      const rightAlign = block.rightAlign ?? (block.align === "center" ? "center" : "right");
      const leftSize = block.leftSize ?? block.size ?? "normal";
      const rightSize = block.rightSize ?? block.size ?? "normal";
      const preferredSize = leftSize === rightSize ? leftSize : "normal";
      const leftBold = block.leftBold ?? block.bold ?? false;
      const rightBold = block.rightBold ?? block.bold ?? false;
      const bold = leftBold === rightBold ? leftBold : leftBold || rightBold;

      const lines: Array<{ left: string; right: string }> = [];
      if (isItemDataKey(leftKey) || isItemDataKey(rightKey)) {
        for (const item of order.items) {
          const left = isItemDataKey(leftKey) ? itemFieldValue(leftKey, item) : orderFieldValue(leftKey, block);
          const right = isItemDataKey(rightKey) ? itemFieldValue(rightKey, item) : orderFieldValue(rightKey, block);
          if (!left && !right) continue;
          lines.push({ left, right });
        }
      } else {
        const left = orderFieldValue(leftKey, block);
        const right = orderFieldValue(rightKey, block);
        if (left || right) lines.push({ left, right });
      }
      if (!lines.length) continue;

      const minColumns = lines.reduce((max, line) => Math.max(max, line.left.length + line.right.length + 1), 1);
      const size = fitPresetToContent(width, preferredSize, minColumns);
      const blockWidth = columnsForSize(width, size);
      out.push(escPosAlignCommand("left"));
      out.push(QZ_SIZE_TO_ESC_POS[size]);
      out.push(bold ? "\x1B\x45\x01" : "\x1B\x45\x00");
      for (const line of lines) {
        out.push(`${twoColumnLine(line.left, line.right, blockWidth, leftAlign, rightAlign)}${nl}`);
      }
      out.push("\x1B\x61\x00");
      out.push(QZ_SIZE_TO_ESC_POS.normal);
      out.push("\x1B\x45\x00");
      continue;
    }
    if (block.kind === "items_template") {
      const rows = itemTemplateRows(block);
      for (const [itemIndex, item] of order.items.entries()) {
        for (const row of rows) {
          if (row.leftDataKey || row.rightDataKey) {
            const safeLeftKey = row.leftDataKey ?? "item_qty_price";
            const safeRightKey = row.rightDataKey ?? "item_total";
            const { leftAlign, rightAlign, leftSize, rightSize, leftBold, rightBold } = rowColumnSettingsFromRow(row);
            const preferredSize = leftSize === rightSize ? leftSize : "normal";
            const left =
              safeLeftKey === "free_text"
                ? toLatin1Safe(row.leftText ?? "")
                : safeLeftKey === "blank_line"
                ? ""
                : itemFieldValue(safeLeftKey, item);
            const right =
              safeRightKey === "free_text"
                ? toLatin1Safe(row.rightText ?? "")
                : safeRightKey === "blank_line"
                ? ""
                : itemFieldValue(safeRightKey, item);
            if (!left && !right) continue;

            const minColumns = Math.max(left.length + right.length + 1, 1);
            const size = fitPresetToContent(width, preferredSize, minColumns);
            const blockWidth = columnsForSize(width, size);
            const bold = leftBold === rightBold ? leftBold : leftBold || rightBold;
            out.push(escPosAlignCommand("left"));
            out.push(QZ_SIZE_TO_ESC_POS[size]);
            out.push(bold ? "\x1B\x45\x01" : "\x1B\x45\x00");
            out.push(`${twoColumnLine(left, right, blockWidth, leftAlign, rightAlign)}${nl}`);
            out.push("\x1B\x61\x00");
            out.push(QZ_SIZE_TO_ESC_POS.normal);
            out.push("\x1B\x45\x00");
            continue;
          }

          const dataKey = row.dataKey ?? "item_name";
          const align = row.align ?? "left";
          const size = row.size ?? "normal";
          const blockWidth = columnsForSize(width, size);
          const text =
            dataKey === "free_text"
              ? toLatin1Safe(row.text ?? "")
              : dataKey === "blank_line"
              ? ""
              : itemFieldValue(dataKey, item);
          if (!text && dataKey !== "blank_line") continue;
          out.push(escPosAlignCommand(align));
          out.push(QZ_SIZE_TO_ESC_POS[size]);
          out.push((row.bold ?? false) ? "\x1B\x45\x01" : "\x1B\x45\x00");
          if (dataKey === "item_notes") {
            for (const line of wrapText(text, blockWidth)) {
              out.push(`${alignLine(line, blockWidth, align)}${nl}`);
            }
          } else {
            out.push(`${alignLine(text, blockWidth, align)}${nl}`);
          }
          out.push("\x1B\x61\x00");
          out.push(QZ_SIZE_TO_ESC_POS.normal);
          out.push("\x1B\x45\x00");
        }
        if (itemIndex < order.items.length - 1) {
          out.push(nl);
        }
      }
      continue;
    }
    if (block.kind === "customer") {
      const size = block.size ?? "normal";
      const blockWidth = columnsForSize(width, size);
      const { left: leftParts, right: rightParts } = effectiveComposeParts(block, "customer");
      const values = {
        customer_name: toLatin1Safe(customerName),
        customer_phone: toLatin1Safe(phone),
      };
      const left = composeFromParts(leftParts, values);
      const right = composeFromParts(rightParts, values);
      out.push(escPosAlignCommand("left"));
      out.push(QZ_SIZE_TO_ESC_POS[size]);
      out.push(block.bold ? "\x1B\x45\x01" : "\x1B\x45\x00");
      out.push(`${right ? leftRightLine(left, right, blockWidth) : alignLine(left, blockWidth, "left")}${nl}`);
      out.push("\x1B\x61\x00");
      out.push(QZ_SIZE_TO_ESC_POS.normal);
      out.push("\x1B\x45\x00");
      continue;
    }
    if (block.kind === "items") {
      const size = block.size ?? "normal";
      const blockWidth = columnsForSize(width, size);
      const { left: leftParts, right: rightParts } = effectiveComposeParts(block, "items");
      out.push(escPosAlignCommand("left"));
      out.push(QZ_SIZE_TO_ESC_POS[size]);
      out.push("\x1B\x45\x00");
      for (const item of order.items) {
        const name = toLatin1Safe(item.drinkName);
        const qty = toLatin1Safe(String(item.qty));
        const unitPrice = toLatin1Safe(formatBRLPrint(item.unitPrice));
        const qtyPrice = toLatin1Safe(`${item.qty} x ${formatBRLPrint(item.unitPrice)}`);
        const total = toLatin1Safe(formatBRLPrint(item.lineTotal));
        const values = {
          item_name: name,
          item_qty: qty,
          item_unit_price: unitPrice,
          item_qty_price: qtyPrice,
          item_total: total,
        };
        const composedLeft = composeFromParts(leftParts, values);
        const composedRight = composeFromParts(rightParts, values);
        out.push(`${alignLine(name, blockWidth, "left")}${nl}`);
        out.push(`${leftRightLine(composedLeft, composedRight, blockWidth)}${nl}`);
        const notes = item.drinkNotes ?? item.notes;
        if (notes) {
          for (const line of wrapText(`obs: ${toLatin1Safe(notes)}`, blockWidth)) {
            out.push(`${alignLine(line, blockWidth, "left")}${nl}`);
          }
        }
        out.push(nl);
      }
      out.push("\x1B\x61\x00");
      out.push(QZ_SIZE_TO_ESC_POS.normal);
      continue;
    }
    if (block.kind === "items_count") {
      const size = block.size ?? "normal";
      const blockWidth = columnsForSize(width, size);
      const { left: leftParts, right: rightParts } = effectiveComposeParts(block, "items_count");
      const values = {
        items_label: "ITENS",
        items_count: String(order.items.reduce((acc, item) => acc + item.qty, 0)),
      };
      out.push(escPosAlignCommand("left"));
      out.push(QZ_SIZE_TO_ESC_POS[size]);
      out.push("\x1B\x45\x00");
      out.push(`${leftRightLine(composeFromParts(leftParts, values), composeFromParts(rightParts, values), blockWidth)}${nl}`);
      out.push("\x1B\x61\x00");
      out.push(QZ_SIZE_TO_ESC_POS.normal);
      continue;
    }
    if (block.kind === "notes") {
      if (!order.notes) continue;
      printTextBlock(block, `Obs pedido: ${order.notes}`, { allowWrap: true });
      out.push(nl);
      continue;
    }
    if (block.kind === "total") {
      const label = toLatin1Safe(block.text?.trim() || "TOTAL");
      const { left: leftParts, right: rightParts } = effectiveComposeParts(block, "total");
      const leftText = composeFromParts(leftParts, { total_label: label, total_value: totalText });
      const rightText = composeFromParts(rightParts, { total_label: label, total_value: totalText });
      const align = block.align ?? "left";
      const rawSize = block.size ?? "2x";
      const size = fitPresetToContent(width, rawSize, rightText.length + leftText.length + 1);
      const blockWidth = columnsForSize(width, size);
      out.push(escPosAlignCommand(align));
      out.push(QZ_SIZE_TO_ESC_POS[size]);
      out.push(block.bold === false ? "\x1B\x45\x00" : "\x1B\x45\x01");
      out.push(`${leftRightLine(leftText, rightText, blockWidth)}${nl}`);
      out.push("\x1B\x61\x00");
      out.push(QZ_SIZE_TO_ESC_POS.normal);
      out.push("\x1B\x45\x00");
      continue;
    }
    if (block.kind === "custom") {
      if (!block.text?.trim()) continue;
      printTextBlock(block, block.text);
    }
  }

  out.push(`${nl}${nl}`);
  out.push("\x1D\x56\x41\x10"); // full cut
  return out.join("");
}
