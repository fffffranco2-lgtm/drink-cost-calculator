"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  internalButtonStyle,
  internalCardStyle,
  internalFocusStyle,
  internalHeaderCardStyle,
  internalPageStyle,
  internalSmallTextStyle,
} from "@/app/admin/internal-theme";
import {
  AUTO_PRINT_STORAGE_KEY,
  QZ_PRINTER_STORAGE_KEY,
  type QzApi,
  type QzConnectionState,
  type QzTextSizePreset,
} from "@/lib/qz-tray";
import {
  DEFAULT_LAYOUT_LOGO_PATH,
  defaultPrintLayout,
  getActiveLayoutIdFromStorage,
  getLayoutsFromStorage,
  resolveActiveLayout,
  type PrintAlign,
  type PrintDataKey,
  type PrintLayout,
  type PrintLayoutBlock,
} from "@/lib/print-layouts";

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
const ESC_POS_LINE_WIDTH = 32;

const QZ_SIZE_TO_SCALE: Record<QzTextSizePreset, number> = {
  normal: 1,
  "2x": 2,
  "3x": 3,
};

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

function columnsForSize(baseWidth: number, preset: QzTextSizePreset) {
  return Math.max(8, Math.floor(baseWidth / QZ_SIZE_TO_SCALE[preset]));
}

function fitPresetToContent(baseWidth: number, preferred: QzTextSizePreset, minColumns: number): QzTextSizePreset {
  let preset = preferred;
  while (preset !== "normal" && columnsForSize(baseWidth, preset) < minColumns) {
    preset = preset === "3x" ? "2x" : "normal";
  }
  return preset;
}

function buildEscPosBitImage24(raster: Uint8Array, widthDots: number, heightDots: number) {
  const out: string[] = [];
  const widthBytes = widthDots / 8;
  const getPixel = (x: number, y: number) => {
    const byte = raster[y * widthBytes + (x >> 3)];
    return (byte & (0x80 >> (x & 7))) !== 0;
  };

  out.push("\x1B\x61\x01"); // center
  out.push("\x1B\x33\x18"); // line spacing = 24

  for (let y = 0; y < heightDots; y += 24) {
    out.push(`\x1B\x2A\x21${String.fromCharCode(widthDots & 0xff, (widthDots >> 8) & 0xff)}`);
    for (let x = 0; x < widthDots; x += 1) {
      for (let band = 0; band < 3; band += 1) {
        let slice = 0;
        for (let bit = 0; bit < 8; bit += 1) {
          const yy = y + band * 8 + bit;
          if (yy >= heightDots) continue;
          if (getPixel(x, yy)) slice |= 0x80 >> bit;
        }
        out.push(String.fromCharCode(slice));
      }
    }
    out.push("\n");
  }

  out.push("\x1B\x32"); // default line spacing
  out.push("\x1B\x61\x00"); // left
  return out.join("");
}

async function buildEscPosRasterLogo(imagePath: string, maxWidthDots = 384, maxHeightDots = 160) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.decoding = "async";
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Falha ao carregar logo para impressão."));
    el.src = imagePath;
  });

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("Logo sem dimensões válidas para impressão.");
  }

  let targetWidth = Math.max(8, Math.floor(Math.min(maxWidthDots, sourceWidth) / 8) * 8);
  let targetHeight = Math.max(8, Math.round((sourceHeight * targetWidth) / sourceWidth));
  if (targetHeight > maxHeightDots) {
    const scale = maxHeightDots / targetHeight;
    targetHeight = maxHeightDots;
    targetWidth = Math.max(8, Math.floor((targetWidth * scale) / 8) * 8);
  }
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Contexto 2D indisponível para rasterizar logo.");
  }

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight).data;
  const widthBytes = targetWidth / 8;
  const raster = new Uint8Array(widthBytes * targetHeight);

  for (let y = 0; y < targetHeight; y++) {
    for (let xByte = 0; xByte < widthBytes; xByte++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xByte * 8 + bit;
        const offset = (y * targetWidth + x) * 4;
        const r = imageData[offset];
        const g = imageData[offset + 1];
        const b = imageData[offset + 2];
        const alpha = imageData[offset + 3] / 255;
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        const composite = 255 - alpha * (255 - luminance);
        if (composite < 160) {
          byte |= 0x80 >> bit;
        }
      }
      raster[y * widthBytes + xByte] = byte;
    }
  }

  return buildEscPosBitImage24(raster, targetWidth, targetHeight);
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
  const safeLeft = left.replace(/\s+/g, " ").trim();
  const safeRight = right.replace(/\s+/g, " ").trim();
  const minGap = 1;
  const maxLeftLen = Math.max(0, width - safeRight.length - minGap);
  const croppedLeft = safeLeft.length > maxLeftLen ? safeLeft.slice(0, maxLeftLen) : safeLeft;
  const spaces = Math.max(minGap, width - croppedLeft.length - safeRight.length);
  return `${croppedLeft}${" ".repeat(spaces)}${safeRight}`;
}

function effectiveComposeParts(block: PrintLayoutBlock, kind: ComposeElementKind) {
  const defaults = COMPOSE_DEFAULTS[kind];
  const left = Array.isArray(block.composeLeft) && block.composeLeft.length ? block.composeLeft : defaults.left;
  const right = Array.isArray(block.composeRight) && block.composeRight.length ? block.composeRight : defaults.right;
  return { left, right };
}

function composeFromParts(parts: string[], values: Record<string, string>) {
  return parts
    .map((part) => values[part] ?? "")
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
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

function readActivePrintLayout(): PrintLayout {
  try {
    const layouts = getLayoutsFromStorage();
    const activeLayoutId = getActiveLayoutIdFromStorage();
    return resolveActiveLayout(layouts, activeLayoutId);
  } catch {
    return defaultPrintLayout();
  }
}

function isLikelyVirtualPrinter(name: string) {
  const n = name.trim().toLowerCase();
  return n.includes("fax") || n.includes("pdf") || n.includes("xps");
}

function choosePreferredPrinter(candidates: string[]) {
  const cleaned = candidates.map((name) => name.trim()).filter(Boolean);
  if (!cleaned.length) return "";
  const nonVirtual = cleaned.find((name) => !isLikelyVirtualPrinter(name));
  return nonVirtual ?? cleaned[0];
}

async function buildEscPosTicket(order: AdminOrder, layout: PrintLayout) {
  const width = ESC_POS_LINE_WIDTH;
  const nl = "\n";
  const sourceText = order.source === "mesa_qr" && order.tableCode ? `Mesa ${order.tableCode}` : "Balcao";
  const customerName = order.customerName || "Cliente nao informado";
  const phone = order.customerPhone ? order.customerPhone : "";
  const createdAt = new Date(order.createdAt).toLocaleString("pt-BR");
  const totalText = toLatin1Safe(formatBRLPrint(order.subtotal));
  const itemsCountText = String(order.items.reduce((acc, item) => acc + item.qty, 0));

  const out: string[] = [];

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
    if (key === "item_notes") return toLatin1Safe(item.drinkNotes ?? item.notes ?? "");
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
        for (const item of order.items) {
          const text = itemFieldValue(dataKey, item);
          if (!text) continue;
          if (dataKey === "item_notes") {
            for (const line of wrapText(text, blockWidth)) {
              out.push(`${alignLine(line, blockWidth, align)}${nl}`);
            }
          } else {
            out.push(`${alignLine(text, blockWidth, align)}${nl}`);
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
      setOrdersError(message);
      setQzConnectionState("disconnected");
    } finally {
      setQzBusy(false);
    }
  }, [configureQzSecurity, loadQz, resolveQzPrinter]);

  useEffect(() => {
    try {
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
        await printOrderViaQz(order);
      }
    });
  }, [orders, autoPrintEnabled, printOrderViaQz]);

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
  }, [orders.length, ordersError, autoPrintEnabled]);

  const page: React.CSSProperties = { ...internalPageStyle };
  const container: React.CSSProperties = { maxWidth: 1200, margin: "0 auto" };
  const card: React.CSSProperties = { ...internalCardStyle };
  const headerCard: React.CSSProperties = { ...internalHeaderCardStyle };
  const small: React.CSSProperties = { ...internalSmallTextStyle, fontSize: FONT_SCALE.sm };
  const btn: React.CSSProperties = { ...internalButtonStyle, fontWeight: 700 };

  return (
    <div style={page}>
      <style>{`${internalFocusStyle}
        @media (max-width: 980px) { .orders-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      <div className="app-shell" style={container}>
        <div style={{ ...headerCard, marginBottom: 12, position: "relative", paddingRight: 64 }}>
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
              <Link
                href="/admin?tab=settings&settingsTab=impressao"
                style={{
                  ...btn,
                  width: 36,
                  height: 36,
                  padding: 0,
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                }}
                title="Configurações de impressão"
                aria-label="Configurações de impressão"
              >
                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>
                  settings
                </span>
              </Link>
              <button
                style={{ ...btn, background: activeSession ? "var(--pill)" : "var(--pillActive)", borderColor: activeSession ? "#ddc7aa" : "#b7d9d4" }}
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
            <div style={small}>Impressão direta ESC/POS com encoding ISO-8859-1. Ajustes em Configurações &gt; Impressão.</div>
          </div>
          {ordersError ? <div style={{ ...small, color: "#b00020", marginTop: 8 }}>{ordersError}</div> : null}
          <button
            style={{
              ...btn,
              position: "absolute",
              right: 16,
              bottom: 16,
              width: 40,
              height: 40,
              borderRadius: 999,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
            onClick={() => void loadOrders()}
            disabled={ordersLoading || Boolean(updatingOrderId)}
            aria-label={ordersLoading ? "Atualizando pedidos" : "Atualizar pedidos"}
            title={ordersLoading ? "Atualizando..." : "Atualizar"}
          >
            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 20, lineHeight: 1 }}>
              {ordersLoading ? "autorenew" : "refresh"}
            </span>
          </button>
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
                  const statusButtonBackground =
                    statusKey === "pendente" ? "#fde2e2" : statusKey === "em_progresso" ? "#fdf0c4" : "#dcfce7";
                  const statusButtonBorder =
                    statusKey === "pendente" ? "#e9b9b9" : statusKey === "em_progresso" ? "#e8d08d" : "#a7d9bc";

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
                                void printOrderViaQz(order);
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
