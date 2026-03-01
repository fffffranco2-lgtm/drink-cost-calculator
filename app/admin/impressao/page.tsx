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
  DEFAULT_LAYOUT_LOGO_PATH,
  DEFAULT_PRINT_LAYOUT_ID,
  blockLabel,
  defaultPrintLayout,
  getActiveLayoutIdFromStorage,
  getLayoutsFromStorage,
  resolveActiveLayout,
  saveLayoutsToStorage,
  setActiveLayoutIdInStorage,
  type PrintAlign,
  type PrintDataKey,
  type PrintItemTemplateRow,
  type PrintLayout,
  type PrintLayoutBlock,
} from "@/lib/print-layouts";
import { QZ_PRINTER_STORAGE_KEY, type QzApi, type QzTextSizePreset } from "@/lib/qz-tray";

const SIZE_OPTIONS: QzTextSizePreset[] = ["normal", "2x", "3x"];
const ALIGN_OPTIONS: PrintAlign[] = ["left", "center", "right", "justify"];
const FREE_TEXT_KEY: PrintDataKey = "free_text";
const BLANK_LINE_KEY: PrintDataKey = "blank_line";
const ALIGN_ICON: Record<PrintAlign, string> = {
  left: "format_align_left",
  center: "format_align_center",
  right: "format_align_right",
  justify: "format_align_justify",
};
const ALIGN_LABEL: Record<PrintAlign, string> = {
  left: "Alinhar à esquerda",
  center: "Alinhar ao centro",
  right: "Alinhar à direita",
  justify: "Justificar",
};
const LINE_WIDTH = 32;
const PREVIEW_CHAR_CELL_OPTIONS = [7.5, 8, 8.5] as const;
const DEFAULT_PREVIEW_CHAR_CELL_PX = 8;
const PREVIEW_CHAR_CELL_STORAGE_KEY = "orders_preview_char_cell_px";
type PreviewFontProfile = "modern" | "thermal";
const PREVIEW_FONT_PROFILE_STORAGE_KEY = "orders_preview_font_profile";
const PREVIEW_FONT_PROFILES: Array<{ id: PreviewFontProfile; label: string }> = [
  { id: "thermal", label: "Térmica" },
  { id: "modern", label: "Moderna" },
];
const PREVIEW_SIDE_PADDING_PX = 10;
const PREVIEW_VERTICAL_PADDING_PX = 10;
const PREVIEW_SCALE_OPTIONS = [1, 1.25, 1.5] as const;
const ADMIN_STATE_STORAGE_KEY = "mixologia_drink_cost_v4_menu_rounding";
const LINE_EDITOR_WIDTH_PX = 320;
const SIZE_TO_ESC: Record<QzTextSizePreset, string> = {
  normal: "\x1D\x21\x00",
  "2x": "\x1D\x21\x11",
  "3x": "\x1D\x21\x22",
};

function buildEscPosBitImage24(raster: Uint8Array, widthDots: number, heightDots: number) {
  const out: string[] = [];
  const widthBytes = widthDots / 8;
  const getPixel = (x: number, y: number) => {
    const byte = raster[y * widthBytes + (x >> 3)];
    return (byte & (0x80 >> (x & 7))) !== 0;
  };

  out.push("\x1B\x61\x01");
  out.push("\x1B\x33\x18");

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

  out.push("\x1B\x32");
  out.push("\x1B\x61\x00");
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
        if (composite < 160) byte |= 0x80 >> bit;
      }
      raster[y * widthBytes + xByte] = byte;
    }
  }

  return buildEscPosBitImage24(raster, targetWidth, targetHeight);
}

type ComposeElementKind = "customer" | "items" | "items_count" | "total";
type LineEditorType = "text" | "separator" | "logo" | "items";

const COMPOSE_DEFAULTS: Record<ComposeElementKind, { left: string[]; right: string[] }> = {
  customer: { left: ["customer_name"], right: ["customer_phone"] },
  items: { left: ["item_qty_price"], right: ["item_total"] },
  items_count: { left: ["items_label"], right: ["items_count"] },
  total: { left: ["total_label"], right: ["total_value"] },
};

const DATA_KEY_GROUPS: Array<{ label: string; keys: PrintDataKey[] }> = [
  { label: "Pedido", keys: ["code", "datetime", "source", "order_notes"] },
  { label: "Cliente", keys: ["customer_name", "customer_phone"] },
  { label: "Item", keys: ["item_name", "item_qty", "item_unit_price", "item_qty_price", "item_total", "item_notes"] },
  { label: "Resumo", keys: ["items_label", "items_count", "total_label", "total_value"] },
  { label: "Custom", keys: [FREE_TEXT_KEY, BLANK_LINE_KEY] },
];
const ITEM_DATA_KEY_GROUPS: Array<{ label: string; keys: PrintDataKey[] }> = [
  { label: "Item", keys: ["item_name", "item_qty", "item_unit_price", "item_qty_price", "item_total", "item_notes"] },
  { label: "Custom", keys: [FREE_TEXT_KEY, BLANK_LINE_KEY] },
];

const DATA_KEY_LABEL: Record<PrintDataKey, string> = {
  code: "Codigo pedido",
  datetime: "Data/hora",
  source: "Origem",
  order_notes: "Obs. pedido",
  customer_name: "Nome cliente",
  customer_phone: "Telefone cliente",
  item_name: "Nome item",
  item_qty: "Qtd item",
  item_unit_price: "Preco unitario",
  item_qty_price: "Qtd x unitario",
  item_total: "Total item",
  item_notes: "Obs. item",
  items_label: "Rotulo itens",
  items_count: "Contador itens",
  total_label: "Rotulo total",
  total_value: "Valor total",
  free_text: "Texto livre",
  blank_line: "Linha vazia",
};

const LINE_TYPE_OPTIONS: Array<{ value: LineEditorType; label: string }> = [
  { value: "text", label: "Texto" },
  { value: "items", label: "Itens" },
  { value: "separator", label: "Separador" },
  { value: "logo", label: "Logo" },
];

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function wrapText(text: string, width: number) {
  if (width <= 0) return [text];
  const words = text.replace(/\r?\n/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    const candidate = `${current} ${word}`;
    if (lineColumns(candidate) <= width) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function leftRightLineInfo(left: string, right: string, width: number) {
  const safeLeft = left.replace(/\s+/g, " ").trim();
  const safeRight = right.replace(/\s+/g, " ").trim();
  const minGap = 1;
  const maxLeftLen = Math.max(0, width - safeRight.length - minGap);
  const croppedLeft = safeLeft.length > maxLeftLen ? safeLeft.slice(0, maxLeftLen) : safeLeft;
  const spaces = Math.max(minGap, width - croppedLeft.length - safeRight.length);
  return {
    text: `${croppedLeft}${" ".repeat(spaces)}${safeRight}`,
    left: croppedLeft,
    right: safeRight,
    overflow: safeLeft.length > maxLeftLen || safeRight.length + minGap > width,
    overflowColumns: Math.max(0, safeLeft.length - maxLeftLen, safeRight.length + minGap - width),
  };
}

function compactSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

type SampleOrder = {
  code: string;
  createdAt: string;
  source: string;
  customerName: string;
  customerPhone: string;
  notes: string;
  subtotal: string;
  items: Array<{ name: string; qtyPrice: string; total: string; notes?: string }>;
};

const DEFAULT_SAMPLE_ORDER: SampleOrder = {
  code: "A1234",
  createdAt: "01/03/2026 19:35:00",
  source: "Mesa M12",
  customerName: "Mariana Souza",
  customerPhone: "(11) 98888-7766",
  notes: "sem canudo e entregar junto.",
  subtotal: "R$ 123,45",
  items: [
    { name: "Hanky Panky", qtyPrice: "1 x R$ 34,00", total: "R$ 34,00", notes: "pouco gelo" },
    { name: "Negroni", qtyPrice: "2 x R$ 32,00", total: "R$ 64,00", notes: "sem laranja" },
    { name: "Hanky Panky", qtyPrice: "1 x R$ 25,45", total: "R$ 25,45" },
  ],
};

function buildSampleOrderFromDrinkNames(names: string[]) {
  const uniqueNonVesper = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean))).filter((name) => !/vesper/i.test(name));
  const fallback = ["Hanky Panky", "Negroni", "Hanky Panky"];
  const selected = [...uniqueNonVesper];
  for (const name of fallback) {
    if (selected.length >= 3) break;
    selected.push(name);
  }
  const finalNames = selected.slice(0, 3);
  return {
    ...DEFAULT_SAMPLE_ORDER,
    items: DEFAULT_SAMPLE_ORDER.items.map((item, index) => ({
      ...item,
      name: finalNames[index] ?? item.name,
    })),
  };
}

function columnsForSize(size: QzTextSizePreset) {
  if (size === "3x") return 8;
  if (size === "2x") return 13;
  return LINE_WIDTH;
}

function fitPresetToContent(baseWidth: number, preferred: QzTextSizePreset, minColumns: number): QzTextSizePreset {
  let preset = preferred;
  const columnsForPreset = (value: QzTextSizePreset) => {
    if (value === "3x") return Math.max(8, Math.floor(baseWidth / 3));
    if (value === "2x") return Math.max(8, Math.floor(baseWidth / 2));
    return Math.max(8, baseWidth);
  };
  while (preset !== "normal" && columnsForPreset(preset) < minColumns) {
    preset = preset === "3x" ? "2x" : "normal";
  }
  return preset;
}

type PreviewLine =
  | {
      type: "text";
      text: string;
      align?: PrintAlign;
      size?: QzTextSizePreset;
      bold?: boolean;
      strictWidth?: boolean;
      overflowHint?: boolean;
      overflowColumns?: number;
      composedLeft?: string;
      composedRight?: string;
    }
  | {
      type: "row_2col";
      leftText: string;
      rightText: string;
      separator?: string;
      leftAlign: PrintAlign;
      rightAlign: PrintAlign;
      leftSize: QzTextSizePreset;
      rightSize: QzTextSizePreset;
      leftBold: boolean;
      rightBold: boolean;
      leftStrictWidth?: boolean;
      rightStrictWidth?: boolean;
      leftOverflowColumns?: number;
      rightOverflowColumns?: number;
    }
  | { type: "logo"; logoPath: string };

function lineColumns(text: string) {
  return Array.from(text).length;
}

function truncateToColumns(text: string, maxColumns: number) {
  const chars = Array.from(text);
  if (chars.length <= maxColumns) return text;
  if (maxColumns <= 3) return chars.slice(0, maxColumns).join("");
  return `${chars.slice(0, maxColumns - 3).join("")}...`;
}

function normalizeSingleLinePreservePadding(text: string) {
  return text.replace(/\r?\n/g, " ");
}

function decorateDataValue(base: string, options?: { tabCount?: number; prefix?: string; suffix?: string }) {
  const tabs = Math.max(0, Math.min(12, options?.tabCount ?? 0));
  const pad = " ".repeat(tabs * 4);
  const prefix = options?.prefix ?? "";
  const suffix = options?.suffix ?? "";
  return `${pad}${prefix}${base}${suffix}`;
}

function resolveDecoratedDataValue(
  key: PrintDataKey,
  rawValue: string,
  options?: { tabCount?: number; prefix?: string; suffix?: string },
) {
  if (key === BLANK_LINE_KEY) return { text: "", hasValue: true };
  if (key === FREE_TEXT_KEY) {
    const raw = rawValue;
    return { text: decorateDataValue(raw, options), hasValue: raw.trim().length > 0 || (options?.tabCount ?? 0) > 0 };
  }
  const compact = compactSpaces(rawValue);
  if (!compact) return { text: "", hasValue: false };
  return { text: decorateDataValue(compact, options), hasValue: true };
}

function dataKeyPlaceholder(key: PrintDataKey) {
  if (key === FREE_TEXT_KEY) return "Texto livre";
  if (key === BLANK_LINE_KEY) return "Linha vazia";
  return DATA_KEY_LABEL[key];
}

function previewVisibleSpaces(text: string) {
  return text;
}

function fitTextToColumns(text: string, maxColumns: number, align: PrintAlign) {
  const clipped = Array.from(normalizeSingleLinePreservePadding(text)).slice(0, Math.max(0, maxColumns)).join("");
  const used = lineColumns(clipped);
  const spaces = Math.max(0, maxColumns - used);
  if (align === "justify") {
    const leadingMatch = clipped.match(/^ +/);
    const leading = leadingMatch?.[0] ?? "";
    const content = clipped.slice(leading.length).trim();
    const contentWidth = Math.max(0, maxColumns - leading.length);
    if (!content) return `${clipped}${" ".repeat(spaces)}`;
    const words = content.split(/\s+/).filter(Boolean);
    if (words.length <= 1 || contentWidth <= words.join("").length) {
      return `${clipped}${" ".repeat(spaces)}`;
    }
    const letters = words.join("").length;
    const gaps = words.length - 1;
    const totalGapSpaces = Math.max(gaps, contentWidth - letters);
    const baseGap = Math.floor(totalGapSpaces / gaps);
    let extra = totalGapSpaces - baseGap * gaps;
    let justified = "";
    for (let i = 0; i < words.length; i += 1) {
      justified += words[i];
      if (i < gaps) {
        const add = baseGap + (extra > 0 ? 1 : 0);
        if (extra > 0) extra -= 1;
        justified += " ".repeat(Math.max(1, add));
      }
    }
    const result = `${leading}${justified}`.slice(0, maxColumns);
    const resultUsed = lineColumns(result);
    return `${result}${" ".repeat(Math.max(0, maxColumns - resultUsed))}`;
  }
  if (align === "right") return `${" ".repeat(spaces)}${clipped}`;
  if (align === "center") {
    const left = Math.floor(spaces / 2);
    const right = spaces - left;
    return `${" ".repeat(left)}${clipped}${" ".repeat(right)}`;
  }
  return `${clipped}${" ".repeat(spaces)}`;
}

function resolveTwoColumnLayout(totalColumns: number, leftUsedColumns: number, rightUsedColumns: number) {
  const minGap = 1;
  const safeTotal = Math.max(3, totalColumns);
  const usable = Math.max(2, safeTotal - minGap);
  const safeLeftUsed = Math.max(0, leftUsedColumns);
  const safeRightUsed = Math.max(0, rightUsedColumns);
  const totalUsed = safeLeftUsed + safeRightUsed;

  let leftWidth = Math.max(1, Math.floor(usable / 2));
  if (totalUsed > 0) {
    leftWidth = Math.round((usable * safeLeftUsed) / totalUsed);
    leftWidth = Math.max(1, Math.min(usable - 1, leftWidth));
  }
  let rightWidth = usable - leftWidth;
  if (rightWidth < 1) {
    rightWidth = 1;
    leftWidth = usable - 1;
  }

  if (safeLeftUsed > leftWidth && rightWidth > safeRightUsed) {
    const shift = Math.min(safeLeftUsed - leftWidth, rightWidth - safeRightUsed);
    leftWidth += shift;
    rightWidth -= shift;
  }
  if (safeRightUsed > rightWidth && leftWidth > safeLeftUsed) {
    const shift = Math.min(safeRightUsed - rightWidth, leftWidth - safeLeftUsed);
    rightWidth += shift;
    leftWidth -= shift;
  }

  const leftOverflowBy = Math.max(0, safeLeftUsed - leftWidth);
  const rightOverflowBy = Math.max(0, safeRightUsed - rightWidth);
  return {
    leftWidth,
    rightWidth,
    gap: minGap,
    leftOverflowBy,
    rightOverflowBy,
    overlap: leftOverflowBy > 0 || rightOverflowBy > 0,
  };
}

function rowColumnSettings(block: PrintLayoutBlock) {
  return {
    leftAlign: block.leftAlign ?? block.align ?? "left",
    rightAlign: block.rightAlign ?? (block.align === "center" ? "center" : "right"),
    leftSize: block.leftSize ?? block.size ?? "normal",
    rightSize: block.rightSize ?? block.size ?? "normal",
    leftBold: block.leftBold ?? block.bold ?? false,
    rightBold: block.rightBold ?? block.bold ?? false,
  } as const;
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

function isNotesDataKey(key?: PrintDataKey) {
  return key === "item_notes" || key === "order_notes";
}

function lineEditorType(block: PrintLayoutBlock): LineEditorType {
  if (block.kind === "logo") return "logo";
  if (block.kind === "separator") return "separator";
  if (block.kind === "items_template" || block.kind === "items") return "items";
  return "text";
}

function itemTemplateRows(block: PrintLayoutBlock): PrintItemTemplateRow[] {
  if (Array.isArray(block.itemRows) && block.itemRows.length) return block.itemRows;
  if (block.leftDataKey || block.rightDataKey) {
    return [
      {
        id: makeId("itemrow"),
        leftDataKey: block.leftDataKey ?? "item_qty_price",
        rightDataKey: block.rightDataKey ?? "item_total",
        leftText: block.leftText,
        rightText: block.rightText,
        leftTabCount: block.leftTabCount,
        rightTabCount: block.rightTabCount,
        leftPrefix: block.leftPrefix,
        leftSuffix: block.leftSuffix,
        rightPrefix: block.rightPrefix,
        rightSuffix: block.rightSuffix,
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
      id: makeId("itemrow"),
      dataKey:
        isItemDataKey(block.dataKey) || block.dataKey === FREE_TEXT_KEY || block.dataKey === BLANK_LINE_KEY
          ? block.dataKey
          : "item_name",
      text: block.text,
      tabCount: block.tabCount,
      prefix: block.prefix,
      suffix: block.suffix,
      align: block.align ?? "left",
      size: block.size ?? "normal",
      bold: block.bold ?? false,
    },
  ];
}

function itemRowHasTwoColumns(row: PrintItemTemplateRow) {
  return Boolean(row.leftDataKey || row.rightDataKey);
}

function canonicalizeBlock(block: PrintLayoutBlock): PrintLayoutBlock {
  if (block.kind === "customer") {
    return {
      ...block,
      kind: "row_2col",
      leftDataKey: "customer_name",
      rightDataKey: "customer_phone",
      dataKey: undefined,
    };
  }
  if (block.kind === "items_count") {
    return {
      ...block,
      kind: "row_2col",
      leftDataKey: "items_label",
      rightDataKey: "items_count",
      dataKey: undefined,
    };
  }
  if (block.kind === "total") {
    return {
      ...block,
      kind: "row_2col",
      leftDataKey: "total_label",
      rightDataKey: "total_value",
      dataKey: undefined,
      size: block.size ?? "2x",
      bold: block.bold ?? true,
    };
  }
  if (block.kind === "notes") {
    return {
      ...block,
      kind: "data",
      dataKey: "order_notes",
      leftDataKey: undefined,
      rightDataKey: undefined,
    };
  }
  if (block.kind === "code" || block.kind === "datetime" || block.kind === "source") {
    return {
      ...block,
      kind: "data",
      dataKey: block.kind,
      leftDataKey: undefined,
      rightDataKey: undefined,
    };
  }
  if (block.kind === "items") {
    return {
      ...block,
      kind: "items_template",
      itemRows: block.itemRows?.length
        ? block.itemRows
        : [
            {
              id: makeId("itemrow"),
              dataKey: "item_name",
              align: "left",
              size: block.size ?? "normal",
              bold: block.bold ?? false,
            },
            {
              id: makeId("itemrow"),
              leftDataKey: "item_qty_price",
              rightDataKey: "item_total",
              leftAlign: block.leftAlign ?? "left",
              rightAlign: block.rightAlign ?? "right",
              leftSize: block.leftSize ?? block.size ?? "normal",
              rightSize: block.rightSize ?? block.size ?? "normal",
              leftBold: block.leftBold ?? block.bold ?? false,
              rightBold: block.rightBold ?? block.bold ?? false,
            },
          ],
      dataKey: undefined,
      leftDataKey: undefined,
      rightDataKey: undefined,
    };
  }
  if (block.kind === "blank") {
    return {
      ...block,
      kind: "data",
      dataKey: BLANK_LINE_KEY,
      leftDataKey: undefined,
      rightDataKey: undefined,
    };
  }
  return block;
}

function canonicalizeLayout(layout: PrintLayout): PrintLayout {
  return {
    ...layout,
    blocks: layout.blocks.map((block) => canonicalizeBlock(block)),
  };
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

function previewLinesForBlock(block: PrintLayoutBlock, sampleOrder: SampleOrder) {
  const lines: PreviewLine[] = [];
  const align = block.align ?? "left";
  const size = block.size ?? "normal";
  const width = columnsForSize(size);
  const addSingle = (text: string, strictWidth = true) => {
    lines.push({
      type: "text",
      text: normalizeSingleLinePreservePadding(text),
      align,
      size,
      bold: block.bold,
      strictWidth,
    });
  };
  const addWrapped = (text: string, strictWidth = false) => {
    for (const line of wrapText(text, width)) {
      lines.push({ type: "text", text: line, align, size, bold: block.bold, strictWidth });
    }
  };

  if (block.kind === "logo") {
    lines.push({ type: "logo", logoPath: block.logoPath?.trim() || DEFAULT_LAYOUT_LOGO_PATH });
    return lines;
  }
  if (block.kind === "blank") {
    lines.push({ type: "text", text: "" });
    return lines;
  }
  if (block.kind === "separator") {
    const char = separatorLine(block.separatorChar, width);
    lines.push({ type: "text", text: char, align, size, strictWidth: true });
    return lines;
  }
  if (block.kind === "title") {
    addSingle(block.text?.trim() || "PEDIDO");
    return lines;
  }
  if (block.kind === "code") {
    addSingle(sampleOrder.code);
    return lines;
  }
  if (block.kind === "datetime") {
    addSingle(sampleOrder.createdAt);
    return lines;
  }
  if (block.kind === "source") {
    addSingle(sampleOrder.source);
    return lines;
  }
  if (block.kind === "data") {
    const dataKey = block.dataKey ?? "code";
    if (dataKey === BLANK_LINE_KEY) {
      addSingle("", true);
      return lines;
    }
    if (isItemDataKey(dataKey)) {
      for (const item of sampleOrder.items) {
        const base = dataKey === FREE_TEXT_KEY ? block.text ?? "" : sampleItemValue(dataKey, item);
        const resolved = resolveDecoratedDataValue(dataKey, base, {
          tabCount: block.tabCount,
          prefix: block.prefix,
          suffix: block.suffix,
        });
        if (!resolved.hasValue) continue;
        if (dataKey === "item_notes") {
          for (const wrapped of wrapText(resolved.text, width)) {
            lines.push({ type: "text", text: wrapped, align: "left", size, bold: block.bold, strictWidth: true });
          }
        } else {
          lines.push({ type: "text", text: resolved.text, align: "left", size, bold: block.bold, strictWidth: true });
        }
      }
      return lines;
    }
    const base = dataKey === FREE_TEXT_KEY ? block.text ?? "" : sampleOrderValue(dataKey, block, sampleOrder);
    const resolved = resolveDecoratedDataValue(dataKey, base, {
      tabCount: block.tabCount,
      prefix: block.prefix,
      suffix: block.suffix,
    });
    if (!resolved.hasValue) return lines;
    if (dataKey === "order_notes") {
      for (const wrapped of wrapText(resolved.text, width)) {
        addSingle(wrapped, true);
      }
    } else {
      addSingle(resolved.text, true);
    }
    return lines;
  }
  if (block.kind === "items_template") {
    const rows = itemTemplateRows(block);
    for (const [itemIndex, item] of sampleOrder.items.entries()) {
      for (const row of rows) {
        if (itemRowHasTwoColumns(row)) {
          const safeLeftKey =
            isItemDataKey(row.leftDataKey) || row.leftDataKey === FREE_TEXT_KEY || row.leftDataKey === BLANK_LINE_KEY
              ? (row.leftDataKey ?? "item_qty_price")
              : "item_qty_price";
          const safeRightKey =
            isItemDataKey(row.rightDataKey) || row.rightDataKey === FREE_TEXT_KEY || row.rightDataKey === BLANK_LINE_KEY
              ? (row.rightDataKey ?? "item_total")
              : "item_total";
          const { leftAlign, rightAlign, leftSize, rightSize, leftBold, rightBold } = rowColumnSettingsFromRow(row);
          const leftMaxColumns = Math.max(1, Math.floor(columnsForSize(leftSize) / 2));
          const rightMaxColumns = Math.max(1, Math.floor(columnsForSize(rightSize) / 2));
          const leftStrictWidth = !isNotesDataKey(safeLeftKey);
          const rightStrictWidth = !isNotesDataKey(safeRightKey);
          const leftRaw = safeLeftKey === FREE_TEXT_KEY ? row.leftText ?? "" : safeLeftKey === BLANK_LINE_KEY ? "" : sampleItemValue(safeLeftKey, item);
          const rightRaw = safeRightKey === FREE_TEXT_KEY ? row.rightText ?? "" : safeRightKey === BLANK_LINE_KEY ? "" : sampleItemValue(safeRightKey, item);
          const leftResolved = resolveDecoratedDataValue(safeLeftKey, leftRaw, {
            tabCount: row.leftTabCount,
            prefix: row.leftPrefix,
            suffix: row.leftSuffix,
          });
          const rightResolved = resolveDecoratedDataValue(safeRightKey, rightRaw, {
            tabCount: row.rightTabCount,
            prefix: row.rightPrefix,
            suffix: row.rightSuffix,
          });
          const leftText = leftResolved.text;
          const rightText = rightResolved.text;
          const hasContent = leftResolved.hasValue || rightResolved.hasValue;
          if (!hasContent) continue;
          if (!leftText && !rightText) continue;
          lines.push({
            type: "row_2col",
            leftText: normalizeSingleLinePreservePadding(leftText),
            rightText: normalizeSingleLinePreservePadding(rightText),
            leftAlign,
            rightAlign,
            leftSize,
            rightSize,
            leftBold,
            rightBold,
            leftStrictWidth,
            rightStrictWidth,
            leftOverflowColumns: leftStrictWidth ? Math.max(0, lineColumns(leftText) - leftMaxColumns) : 0,
            rightOverflowColumns: rightStrictWidth ? Math.max(0, lineColumns(rightText) - rightMaxColumns) : 0,
          });
          continue;
        }
        const dataKey =
          isItemDataKey(row.dataKey) || row.dataKey === FREE_TEXT_KEY || row.dataKey === BLANK_LINE_KEY
            ? (row.dataKey ?? "item_name")
            : "item_name";
        const base = dataKey === FREE_TEXT_KEY ? row.text ?? "" : dataKey === BLANK_LINE_KEY ? "" : sampleItemValue(dataKey, item);
        const resolved = resolveDecoratedDataValue(dataKey, base, {
          tabCount: row.tabCount,
          prefix: row.prefix,
          suffix: row.suffix,
        });
        if (!resolved.hasValue) continue;
        lines.push({
          type: "text",
          text: resolved.text,
          align: row.align ?? block.align ?? "left",
          size: row.size ?? block.size ?? "normal",
          bold: row.bold ?? block.bold,
          strictWidth: dataKey !== "item_notes",
        });
      }
      if (itemIndex < sampleOrder.items.length - 1) {
        lines.push({ type: "text", text: "", align: "left", size: "normal", strictWidth: true });
      }
    }
    return lines;
  }
  if (block.kind === "row_2col") {
    const leftKey = block.leftDataKey ?? "items_label";
    const rightKey = block.rightDataKey ?? "items_count";
    const { leftAlign, rightAlign, leftSize, rightSize, leftBold, rightBold } = rowColumnSettings(block);
    const leftMaxColumns = Math.max(1, Math.floor(columnsForSize(leftSize) / 2));
    const rightMaxColumns = Math.max(1, Math.floor(columnsForSize(rightSize) / 2));
    const leftStrictWidth = !isNotesDataKey(leftKey);
    const rightStrictWidth = !isNotesDataKey(rightKey);
    const lineFor = (leftText: string, rightText: string) => {
      const safeLeft = normalizeSingleLinePreservePadding(leftText);
      const safeRight = normalizeSingleLinePreservePadding(rightText);
      lines.push({
        type: "row_2col",
        leftText: safeLeft,
        rightText: safeRight,
        leftAlign,
        rightAlign,
        leftSize,
        rightSize,
        leftBold,
        rightBold,
        leftStrictWidth,
        rightStrictWidth,
        leftOverflowColumns: leftStrictWidth ? Math.max(0, lineColumns(safeLeft) - leftMaxColumns) : 0,
        rightOverflowColumns: rightStrictWidth ? Math.max(0, lineColumns(safeRight) - rightMaxColumns) : 0,
      });
    };
    if (isItemDataKey(leftKey) || isItemDataKey(rightKey)) {
      for (const item of sampleOrder.items) {
        const leftRaw =
          leftKey === FREE_TEXT_KEY
            ? block.leftText ?? ""
            : leftKey === BLANK_LINE_KEY
              ? ""
              : isItemDataKey(leftKey)
                ? sampleItemValue(leftKey, item)
                : sampleOrderValue(leftKey, block, sampleOrder);
        const rightRaw =
          rightKey === FREE_TEXT_KEY
            ? block.rightText ?? ""
            : rightKey === BLANK_LINE_KEY
              ? ""
              : isItemDataKey(rightKey)
                ? sampleItemValue(rightKey, item)
                : sampleOrderValue(rightKey, block, sampleOrder);
        const leftResolved = resolveDecoratedDataValue(leftKey, leftRaw, {
          tabCount: block.leftTabCount,
          prefix: block.leftPrefix,
          suffix: block.leftSuffix,
        });
        const rightResolved = resolveDecoratedDataValue(rightKey, rightRaw, {
          tabCount: block.rightTabCount,
          prefix: block.rightPrefix,
          suffix: block.rightSuffix,
        });
        const left = leftResolved.text;
        const right = rightResolved.text;
        const hasContent = leftResolved.hasValue || rightResolved.hasValue;
        if (!hasContent) continue;
        if (!left && !right) continue;
        lineFor(left, right);
      }
      return lines;
    }
    const leftResolved = resolveDecoratedDataValue(
      leftKey,
      leftKey === FREE_TEXT_KEY ? block.leftText ?? "" : leftKey === BLANK_LINE_KEY ? "" : sampleOrderValue(leftKey, block, sampleOrder),
      {
      tabCount: block.leftTabCount,
      prefix: block.leftPrefix,
      suffix: block.leftSuffix,
    });
    const rightResolved = resolveDecoratedDataValue(
      rightKey,
      rightKey === FREE_TEXT_KEY ? block.rightText ?? "" : rightKey === BLANK_LINE_KEY ? "" : sampleOrderValue(rightKey, block, sampleOrder),
      {
      tabCount: block.rightTabCount,
      prefix: block.rightPrefix,
      suffix: block.rightSuffix,
    });
    const left = leftResolved.text;
    const right = rightResolved.text;
    if (!(leftResolved.hasValue || rightResolved.hasValue)) return lines;
    if (!left && !right) return lines;
    lineFor(left, right);
    return lines;
  }
  if (block.kind === "customer") {
    const customerName = compactSpaces(sampleOrder.customerName);
    if (customerName) addSingle(customerName, true);
    return lines;
  }
  if (block.kind === "items") {
    const { left: leftParts, right: rightParts } = effectiveComposeParts(block, "items");
    for (const item of sampleOrder.items) {
      lines.push({ type: "text", text: compactSpaces(item.name), align: "left", size, strictWidth: true });
      const itemValues = {
        item_name: compactSpaces(item.name),
        item_qty: compactSpaces(item.qtyPrice.split("x")[0] ?? ""),
        item_unit_price: compactSpaces(item.qtyPrice.split("x")[1] ?? ""),
        item_qty_price: compactSpaces(item.qtyPrice),
        item_total: compactSpaces(item.total),
      };
      const composedLeft = composeFromParts(leftParts, itemValues);
      const composedRight = composeFromParts(rightParts, itemValues);
      const itemLine = leftRightLineInfo(composedLeft, composedRight, width);
      lines.push({
        type: "text",
        text: itemLine.text,
        align: "left",
        size,
        strictWidth: true,
        overflowHint: itemLine.overflow,
        overflowColumns: itemLine.overflowColumns,
        composedLeft: itemLine.left,
        composedRight: itemLine.right,
      });
      if (item.notes) lines.push({ type: "text", text: `obs: ${compactSpaces(item.notes)}`, align: "left", size, strictWidth: false });
      lines.push({ type: "text", text: "" });
    }
    return lines;
  }
  if (block.kind === "items_count") {
    const { left: leftParts, right: rightParts } = effectiveComposeParts(block, "items_count");
    const countValues = {
      items_label: "ITENS",
      items_count: String(sampleOrder.items.length),
    };
    const countLine = leftRightLineInfo(composeFromParts(leftParts, countValues), composeFromParts(rightParts, countValues), width);
    lines.push({
      type: "text",
      text: countLine.text,
      align: "left",
      size,
      strictWidth: true,
      overflowHint: countLine.overflow,
      overflowColumns: countLine.overflowColumns,
      composedLeft: countLine.left,
      composedRight: countLine.right,
    });
    return lines;
  }
  if (block.kind === "notes") {
    addWrapped(`Obs pedido: ${sampleOrder.notes}`, true);
    return lines;
  }
  if (block.kind === "total") {
    const label = block.text?.trim() || "TOTAL";
    const { left: leftParts, right: rightParts } = effectiveComposeParts(block, "total");
    const totalValues = {
      total_label: label,
      total_value: sampleOrder.subtotal,
    };
    const totalLine = leftRightLineInfo(composeFromParts(leftParts, totalValues), composeFromParts(rightParts, totalValues), width);
    lines.push({
      type: "text",
      text: totalLine.text,
      align,
      size,
      bold: block.bold ?? true,
      strictWidth: true,
      overflowHint: totalLine.overflow,
      overflowColumns: totalLine.overflowColumns,
      composedLeft: totalLine.left,
      composedRight: totalLine.right,
    });
    return lines;
  }
  if (block.kind === "custom") {
    addSingle(block.text?.trim() || "Texto livre");
  }
  return lines;
}

function sizeStep(value: QzTextSizePreset, direction: -1 | 1): QzTextSizePreset {
  const idx = SIZE_OPTIONS.indexOf(value);
  if (idx < 0) return value;
  const next = Math.max(0, Math.min(SIZE_OPTIONS.length - 1, idx + direction));
  return SIZE_OPTIONS[next];
}

function escPosSizeLabel(value: QzTextSizePreset) {
  if (value === "normal") return "Normal";
  return value.toUpperCase();
}

function effectiveComposeParts(block: PrintLayoutBlock, kind: ComposeElementKind) {
  const defaults = COMPOSE_DEFAULTS[kind];
  const left = Array.isArray(block.composeLeft) && block.composeLeft.length ? block.composeLeft : defaults.left;
  const right = Array.isArray(block.composeRight) && block.composeRight.length ? block.composeRight : defaults.right;
  return { left, right };
}

function composeFromParts(parts: string[], values: Record<string, string>) {
  return compactSpaces(parts.map((part) => values[part] ?? "").filter(Boolean).join(" "));
}

function isItemDataKey(key?: PrintDataKey) {
  return Boolean(key && key.startsWith("item_"));
}

function inferLineKeys(block: PrintLayoutBlock) {
  if (block.kind === "items_template" || block.kind === "items") {
    const firstRow = itemTemplateRows(block)[0];
    return {
      twoCols: itemRowHasTwoColumns(firstRow),
      left:
        isItemDataKey(firstRow.leftDataKey) || firstRow.leftDataKey === FREE_TEXT_KEY || firstRow.leftDataKey === BLANK_LINE_KEY
          ? (firstRow.leftDataKey as PrintDataKey)
          : ("item_qty_price" as PrintDataKey),
      right:
        isItemDataKey(firstRow.rightDataKey) || firstRow.rightDataKey === FREE_TEXT_KEY || firstRow.rightDataKey === BLANK_LINE_KEY
          ? (firstRow.rightDataKey as PrintDataKey)
          : ("item_total" as PrintDataKey),
      single:
        isItemDataKey(firstRow.dataKey) || firstRow.dataKey === FREE_TEXT_KEY || firstRow.dataKey === BLANK_LINE_KEY
          ? (firstRow.dataKey as PrintDataKey)
          : ("item_name" as PrintDataKey),
    } as const;
  }
  if (block.kind === "row_2col") {
    return {
      twoCols: true,
      left: block.leftDataKey ?? "items_label",
      right: block.rightDataKey ?? "items_count",
      single: block.leftDataKey ?? "code",
    } as const;
  }
  if (block.kind === "data") {
    return {
      twoCols: false,
      left: block.dataKey ?? "code",
      right: "items_count" as PrintDataKey,
      single: block.dataKey ?? "code",
    } as const;
  }
  if (block.kind === "customer") {
    return { twoCols: false, left: "customer_name" as PrintDataKey, right: "customer_phone" as PrintDataKey, single: "customer_name" as PrintDataKey } as const;
  }
  if (block.kind === "items_count") {
    return { twoCols: true, left: "items_label" as PrintDataKey, right: "items_count" as PrintDataKey, single: "items_count" as PrintDataKey } as const;
  }
  if (block.kind === "total") {
    return { twoCols: true, left: "total_label" as PrintDataKey, right: "total_value" as PrintDataKey, single: "total_value" as PrintDataKey } as const;
  }
  if (block.kind === "notes") {
    return { twoCols: false, left: "order_notes" as PrintDataKey, right: "items_count" as PrintDataKey, single: "order_notes" as PrintDataKey } as const;
  }
  if (block.kind === "datetime") {
    return { twoCols: false, left: "datetime" as PrintDataKey, right: "items_count" as PrintDataKey, single: "datetime" as PrintDataKey } as const;
  }
  if (block.kind === "source") {
    return { twoCols: false, left: "source" as PrintDataKey, right: "items_count" as PrintDataKey, single: "source" as PrintDataKey } as const;
  }
  if (block.kind === "code") {
    return { twoCols: false, left: "code" as PrintDataKey, right: "items_count" as PrintDataKey, single: "code" as PrintDataKey } as const;
  }
  return { twoCols: false, left: "code" as PrintDataKey, right: "items_count" as PrintDataKey, single: "code" as PrintDataKey } as const;
}

function sampleOrderValue(key: PrintDataKey, block: PrintLayoutBlock, sampleOrder: SampleOrder) {
  if (key === FREE_TEXT_KEY) return block.text ?? "";
  if (key === BLANK_LINE_KEY) return "";
  if (key === "code") return sampleOrder.code;
  if (key === "datetime") return sampleOrder.createdAt;
  if (key === "source") return sampleOrder.source;
  if (key === "customer_name") return sampleOrder.customerName;
  if (key === "customer_phone") return sampleOrder.customerPhone;
  if (key === "items_label") return "ITENS";
  if (key === "items_count") return String(sampleOrder.items.length);
  if (key === "total_label") return block.text?.trim() || "TOTAL";
  if (key === "total_value") return sampleOrder.subtotal;
  if (key === "order_notes") return sampleOrder.notes;
  return "";
}

function sampleItemValue(key: PrintDataKey, item: SampleOrder["items"][number]) {
  if (key === "item_name") return item.name;
  if (key === "item_qty") return compactSpaces(item.qtyPrice.split("x")[0] ?? "");
  if (key === "item_unit_price") return compactSpaces(item.qtyPrice.split("x")[1] ?? "");
  if (key === "item_qty_price") return item.qtyPrice;
  if (key === "item_total") return item.total;
  if (key === "item_notes") return item.notes ?? "";
  return "";
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
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 255)) output += char;
    else output += "?";
  }
  return output;
}

function escPosAlignCommand(align: PrintAlign) {
  if (align === "justify") return "\x1B\x61\x00";
  if (align === "center") return "\x1B\x61\x01";
  if (align === "right") return "\x1B\x61\x02";
  return "\x1B\x61\x00";
}

function formatRow2ColForOutput(line: Extract<PreviewLine, { type: "row_2col" }>) {
  const preferredSize = line.leftSize === line.rightSize ? line.leftSize : "normal";
  const minColumns = Math.max(
    1,
    lineColumns(normalizeSingleLinePreservePadding(line.leftText)) +
      lineColumns(normalizeSingleLinePreservePadding(line.rightText)) +
      1,
  );
  const sharedSize = fitPresetToContent(LINE_WIDTH, preferredSize, minColumns);
  const rowWidth = columnsForSize(sharedSize);
  const leftUsed = lineColumns(normalizeSingleLinePreservePadding(line.leftText));
  const rightUsed = lineColumns(normalizeSingleLinePreservePadding(line.rightText));
  const widths = resolveTwoColumnLayout(rowWidth, leftUsed, rightUsed);
  const leftRaw = toLatin1Safe(line.leftText);
  const rightRaw = toLatin1Safe(line.rightText);
  const leftSource =
    line.leftStrictWidth && lineColumns(leftRaw) > widths.leftWidth ? truncateToColumns(leftRaw, widths.leftWidth) : leftRaw;
  const rightSource =
    line.rightStrictWidth && lineColumns(rightRaw) > widths.rightWidth ? truncateToColumns(rightRaw, widths.rightWidth) : rightRaw;
  const leftText = fitTextToColumns(leftSource, widths.leftWidth, line.leftAlign);
  const rightText = fitTextToColumns(rightSource, widths.rightWidth, line.rightAlign);
  return {
    sharedSize,
    rowWidth,
    widths,
    leftText,
    rightText,
    gap: " ".repeat(widths.gap),
  };
}

function formatTextLineForOutput(line: Extract<PreviewLine, { type: "text" }>, fallbackAlign: PrintAlign, fallbackSize: QzTextSizePreset) {
  const align = line.align ?? fallbackAlign;
  const size = line.size ?? fallbackSize;
  const maxColumns = columnsForSize(size);
  const rawText = toLatin1Safe(line.text);
  if (!line.strictWidth) {
    const printable = align === "justify" ? fitTextToColumns(rawText, maxColumns, "justify") : rawText;
    return { align, size, printable, maxColumns, usedColumns: lineColumns(rawText), overflowBy: 0 };
  }
  const source = lineColumns(rawText) > maxColumns ? truncateToColumns(rawText, maxColumns) : rawText;
  const printable = fitTextToColumns(source, maxColumns, align);
  const usedColumns = lineColumns(rawText);
  const overflowBy = Math.max(0, usedColumns - maxColumns);
  return { align, size, printable, maxColumns, usedColumns, overflowBy };
}

export default function PrintLayoutsPage() {
  const [layouts, setLayouts] = useState<PrintLayout[]>([defaultPrintLayout()]);
  const [savedLayouts, setSavedLayouts] = useState<PrintLayout[]>([defaultPrintLayout()]);
  const [activeLayoutId, setActiveLayoutId] = useState(DEFAULT_PRINT_LAYOUT_ID);
  const [savedActiveLayoutId, setSavedActiveLayoutId] = useState(DEFAULT_PRINT_LAYOUT_ID);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [dropTargetBlockId, setDropTargetBlockId] = useState<string | null>(null);
  const [previewScale, setPreviewScale] = useState<(typeof PREVIEW_SCALE_OPTIONS)[number]>(1);
  const [previewCharCellPx, setPreviewCharCellPx] = useState<number>(DEFAULT_PREVIEW_CHAR_CELL_PX);
  const [previewFontProfile, setPreviewFontProfile] = useState<PreviewFontProfile>("thermal");
  const [showGuides, setShowGuides] = useState(true);
  const [saveFeedback, setSaveFeedback] = useState("");
  const [testPrintBusy, setTestPrintBusy] = useState(false);
  const [testPrintError, setTestPrintError] = useState("");
  const [sampleOrder, setSampleOrder] = useState<SampleOrder>(DEFAULT_SAMPLE_ORDER);
  const qzLoaderRef = useRef<Promise<QzApi> | null>(null);
  const qzSecurityReadyRef = useRef(false);

  useEffect(() => {
    try {
      const loadedLayouts = getLayoutsFromStorage().map((layout) => canonicalizeLayout(layout));
      const loadedActiveId = getActiveLayoutIdFromStorage();
      setLayouts(loadedLayouts);
      setSavedLayouts(loadedLayouts);
      setActiveLayoutId(loadedActiveId);
      setSavedActiveLayoutId(loadedActiveId);
      const storedStateRaw = localStorage.getItem(ADMIN_STATE_STORAGE_KEY);
      const storedState = storedStateRaw ? (JSON.parse(storedStateRaw) as { drinks?: Array<{ name?: unknown }> }) : null;
      const drinkNames = Array.isArray(storedState?.drinks)
        ? storedState.drinks.map((drink) => (typeof drink?.name === "string" ? drink.name : "")).filter(Boolean)
        : [];
      setSampleOrder(buildSampleOrderFromDrinkNames(drinkNames));
      const savedCharCellRaw = localStorage.getItem(PREVIEW_CHAR_CELL_STORAGE_KEY);
      const savedCharCell = Number(savedCharCellRaw);
      if (Number.isFinite(savedCharCell) && savedCharCell >= 6 && savedCharCell <= 10) {
        setPreviewCharCellPx(savedCharCell);
      }
      const savedFontProfile = localStorage.getItem(PREVIEW_FONT_PROFILE_STORAGE_KEY);
      if (savedFontProfile === "modern" || savedFontProfile === "thermal") {
        setPreviewFontProfile(savedFontProfile);
      }
    } catch {
      // ignora indisponibilidade de storage
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_CHAR_CELL_STORAGE_KEY, String(previewCharCellPx));
    } catch {
      // ignora indisponibilidade de storage
    }
  }, [previewCharCellPx]);

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_FONT_PROFILE_STORAGE_KEY, previewFontProfile);
    } catch {
      // ignora indisponibilidade de storage
    }
  }, [previewFontProfile]);

  const hasUnsavedChanges = useMemo(() => {
    return activeLayoutId !== savedActiveLayoutId || JSON.stringify(layouts) !== JSON.stringify(savedLayouts);
  }, [activeLayoutId, savedActiveLayoutId, layouts, savedLayouts]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  const activeLayout = useMemo(() => resolveActiveLayout(layouts, activeLayoutId), [layouts, activeLayoutId]);
  const previewTicketContentWidthPx = useMemo(() => LINE_WIDTH * previewCharCellPx, [previewCharCellPx]);
  const previewTicketWidthPx = useMemo(
    () => previewTicketContentWidthPx + PREVIEW_SIDE_PADDING_PX * 2,
    [previewTicketContentWidthPx],
  );
  const previewFontScale = useMemo(
    () => previewCharCellPx / DEFAULT_PREVIEW_CHAR_CELL_PX,
    [previewCharCellPx],
  );
  const previewLetterSpacingPx = useMemo(
    () => (previewCharCellPx - DEFAULT_PREVIEW_CHAR_CELL_PX) * 0.08,
    [previewCharCellPx],
  );
  const previewFontFamily = useMemo(
    () =>
      previewFontProfile === "thermal"
        ? '"Courier New", "Liberation Mono", "Nimbus Mono PS", monospace'
        : 'var(--font-app-mono), "JetBrains Mono", monospace',
    [previewFontProfile],
  );
  const previewBaseWeight = previewFontProfile === "thermal" ? 500 : 400;

  const applyDraft = (nextLayouts: PrintLayout[], nextActiveId = activeLayoutId) => {
    setLayouts(nextLayouts.map((layout) => canonicalizeLayout(layout)));
    setActiveLayoutId(nextActiveId);
  };

  const saveChanges = () => {
    saveLayoutsToStorage(layouts);
    setActiveLayoutIdInStorage(activeLayoutId);
    setSavedLayouts(layouts);
    setSavedActiveLayoutId(activeLayoutId);
    setSaveFeedback("Alterações salvas.");
    window.setTimeout(() => setSaveFeedback(""), 1800);
  };

  const updateActiveLayout = (updater: (layout: PrintLayout) => PrintLayout) => {
    const nextLayouts = layouts.map((layout) => (layout.id === activeLayout.id ? updater(layout) : layout));
    applyDraft(nextLayouts);
  };

  const updateBlock = (index: number, patch: Partial<PrintLayoutBlock>) => {
    updateActiveLayout((layout) => ({
      ...layout,
      blocks: layout.blocks.map((current, i) => (i === index ? { ...current, ...patch } : current)),
    }));
  };

  const createLayout = () => {
    const layout: PrintLayout = {
      id: makeId("layout"),
      name: `Layout ${layouts.length + 1}`,
      blocks: canonicalizeLayout(defaultPrintLayout()).blocks.map((block) => ({ ...block, id: makeId("block") })),
    };
    applyDraft([layout, ...layouts], layout.id);
  };

  const duplicateLayout = () => {
    const duplicated: PrintLayout = {
      id: makeId("layout"),
      name: `${activeLayout.name} (copia)`,
      blocks: activeLayout.blocks.map((block) => ({ ...block, id: makeId("block") })),
    };
    applyDraft([duplicated, ...layouts], duplicated.id);
  };

  const removeLayout = () => {
    if (layouts.length <= 1) return;
    const nextLayouts = layouts.filter((layout) => layout.id !== activeLayout.id);
    const nextActive = nextLayouts[0]?.id ?? DEFAULT_PRINT_LAYOUT_ID;
    applyDraft(nextLayouts, nextActive);
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    updateActiveLayout((layout) => {
      const nextBlocks = [...layout.blocks];
      const target = index + direction;
      if (target < 0 || target >= nextBlocks.length) return layout;
      const [current] = nextBlocks.splice(index, 1);
      nextBlocks.splice(target, 0, current);
      return { ...layout, blocks: nextBlocks };
    });
  };

  const moveBlockTo = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    updateActiveLayout((layout) => {
      if (fromIndex >= layout.blocks.length || toIndex >= layout.blocks.length) return layout;
      const nextBlocks = [...layout.blocks];
      const [current] = nextBlocks.splice(fromIndex, 1);
      nextBlocks.splice(toIndex, 0, current);
      return { ...layout, blocks: nextBlocks };
    });
  };

  const removeBlock = (index: number) => {
    updateActiveLayout((layout) => {
      if (layout.blocks.length <= 1) return layout;
      return { ...layout, blocks: layout.blocks.filter((_, i) => i !== index) };
    });
  };

  const addBlock = () => {
    const base: PrintLayoutBlock = {
      id: makeId("block"),
      kind: "data",
      align: "left",
      size: "normal",
      dataKey: "code",
    };
    updateActiveLayout((layout) => ({ ...layout, blocks: [...layout.blocks, base] }));
  };

  const hasTextField = (block: PrintLayoutBlock) => block.kind === "custom" || block.kind === "title" || block.kind === "total";
  const supportsLineDataEditor = (block: PrintLayoutBlock) => block.kind !== "logo" && block.kind !== "separator";
  const lineHasTwoColumns = (block: PrintLayoutBlock) =>
    block.kind === "row_2col" ||
    ((block.kind === "items_template" || block.kind === "items") &&
      (Array.isArray(block.itemRows) && block.itemRows.length ? itemRowHasTwoColumns(block.itemRows[0]) : Boolean(block.leftDataKey || block.rightDataKey)));
  const lineDataCount = (block: PrintLayoutBlock) => (lineHasTwoColumns(block) ? 2 : 1);
  const editingBlockId = selectedBlockId;
  const editingBlockIndex = editingBlockId ? activeLayout.blocks.findIndex((block) => block.id === editingBlockId) : -1;
  const editingBlock = editingBlockIndex >= 0 ? activeLayout.blocks[editingBlockIndex] : null;
  const lineEditorWidth = LINE_EDITOR_WIDTH_PX;
  const getItemRowsForEditing = (block: PrintLayoutBlock) => itemTemplateRows(block);
  const updateItemRows = (index: number, rows: PrintItemTemplateRow[]) => {
    updateBlock(index, { kind: "items_template", itemRows: rows, dataKey: undefined, leftDataKey: undefined, rightDataKey: undefined });
  };
  const addItemTemplateRow = (index: number, block: PrintLayoutBlock) => {
    const rows = getItemRowsForEditing(block);
    const next: PrintItemTemplateRow = {
      id: makeId("itemrow"),
      dataKey: "item_name",
      tabCount: 0,
      prefix: "",
      suffix: "",
      align: "left",
      size: "normal",
      bold: false,
    };
    updateItemRows(index, [...rows, next]);
  };
  const removeItemTemplateRow = (index: number, block: PrintLayoutBlock, rowIndex: number) => {
    const rows = getItemRowsForEditing(block);
    if (rows.length <= 1) return;
    updateItemRows(index, rows.filter((_, i) => i !== rowIndex));
  };
  const updateItemTemplateRow = (index: number, block: PrintLayoutBlock, rowIndex: number, patch: Partial<PrintItemTemplateRow>) => {
    const rows = getItemRowsForEditing(block);
    updateItemRows(
      index,
      rows.map((row, i) => (i === rowIndex ? { ...row, ...patch } : row)),
    );
  };
  const setItemTemplateRowDataCount = (index: number, block: PrintLayoutBlock, rowIndex: number, nextCount: number) => {
    const rows = getItemRowsForEditing(block);
    const current = rows[rowIndex];
    if (!current) return;
    const clamped = Math.max(1, Math.min(2, nextCount));
    if (clamped === 2) {
      const styles = rowColumnSettingsFromRow(current);
      updateItemTemplateRow(index, block, rowIndex, {
        leftDataKey:
          isItemDataKey(current.leftDataKey) || current.leftDataKey === FREE_TEXT_KEY || current.leftDataKey === BLANK_LINE_KEY
            ? current.leftDataKey
            : "item_qty_price",
        rightDataKey:
          isItemDataKey(current.rightDataKey) || current.rightDataKey === FREE_TEXT_KEY || current.rightDataKey === BLANK_LINE_KEY
            ? current.rightDataKey
            : "item_total",
        leftText: current.leftText ?? current.text,
        rightText: current.rightText,
        leftTabCount: current.leftTabCount ?? current.tabCount ?? 0,
        rightTabCount: current.rightTabCount ?? 0,
        leftPrefix: current.leftPrefix ?? current.prefix ?? "",
        leftSuffix: current.leftSuffix ?? current.suffix ?? "",
        rightPrefix: current.rightPrefix ?? "",
        rightSuffix: current.rightSuffix ?? "",
        dataKey: undefined,
        leftAlign: styles.leftAlign,
        rightAlign: styles.rightAlign,
        leftSize: styles.leftSize,
        rightSize: styles.rightSize,
        leftBold: styles.leftBold,
        rightBold: styles.rightBold,
      });
      return;
    }
    const styles = rowColumnSettingsFromRow(current);
    updateItemTemplateRow(index, block, rowIndex, {
      dataKey:
        isItemDataKey(current.dataKey) || current.dataKey === FREE_TEXT_KEY || current.dataKey === BLANK_LINE_KEY
          ? current.dataKey
          : "item_name",
      text: current.text ?? current.leftText ?? "",
      tabCount: current.tabCount ?? current.leftTabCount ?? 0,
      prefix: current.prefix ?? current.leftPrefix ?? "",
      suffix: current.suffix ?? current.leftSuffix ?? "",
      align: styles.leftAlign,
      size: styles.leftSize,
      bold: styles.leftBold,
      leftDataKey: undefined,
      rightDataKey: undefined,
      leftAlign: undefined,
      rightAlign: undefined,
      leftSize: undefined,
      rightSize: undefined,
      leftBold: undefined,
      rightBold: undefined,
    });
  };

  const page: React.CSSProperties = { ...internalPageStyle };
  const card: React.CSSProperties = { ...internalCardStyle };
  const headerCard: React.CSSProperties = { ...internalHeaderCardStyle };
  const btn: React.CSSProperties = { ...internalButtonStyle, fontWeight: 700 };
  const small: React.CSSProperties = { ...internalSmallTextStyle, fontSize: 12 };


  const setLineColumns = (index: number, block: PrintLayoutBlock, enabled: boolean) => {
    if (!supportsLineDataEditor(block)) return;
    const inferred = inferLineKeys(block);
    const isItemsTemplate = block.kind === "items_template" || block.kind === "items";
    if (enabled) {
      const styles = rowColumnSettings(block);
      updateBlock(index, {
        kind: isItemsTemplate ? "items_template" : "row_2col",
        leftDataKey: inferred.left,
        rightDataKey: inferred.right,
        dataKey: undefined,
        leftText: block.leftText ?? block.text,
        rightText: block.rightText,
        leftTabCount: block.leftTabCount ?? block.tabCount ?? 0,
        rightTabCount: block.rightTabCount ?? 0,
        leftPrefix: block.leftPrefix ?? block.prefix ?? "",
        leftSuffix: block.leftSuffix ?? block.suffix ?? "",
        rightPrefix: block.rightPrefix ?? "",
        rightSuffix: block.rightSuffix ?? "",
        leftAlign: styles.leftAlign,
        rightAlign: styles.rightAlign,
        leftSize: styles.leftSize,
        rightSize: styles.rightSize,
        leftBold: styles.leftBold,
        rightBold: styles.rightBold,
      });
      return;
    }
    const styles = rowColumnSettings(block);
    updateBlock(index, {
      kind: isItemsTemplate ? "items_template" : "data",
      dataKey: inferred.single,
      text: block.text ?? block.leftText ?? "",
      tabCount: block.tabCount ?? block.leftTabCount ?? 0,
      prefix: block.prefix ?? block.leftPrefix ?? "",
      suffix: block.suffix ?? block.leftSuffix ?? "",
      align: styles.leftAlign,
      size: styles.leftSize,
      bold: styles.leftBold,
      leftDataKey: undefined,
      rightDataKey: undefined,
      leftAlign: undefined,
      rightAlign: undefined,
      leftSize: undefined,
      rightSize: undefined,
      leftBold: undefined,
      rightBold: undefined,
    });
  };

  const setLineDataCount = (index: number, block: PrintLayoutBlock, nextCount: number) => {
    const clamped = Math.max(1, Math.min(2, nextCount));
    setLineColumns(index, block, clamped === 2);
  };

  const setLineType = (index: number, block: PrintLayoutBlock, nextType: LineEditorType) => {
    if (nextType === lineEditorType(block)) return;
    if (nextType === "logo") {
      updateBlock(index, {
        kind: "logo",
        logoPath: block.logoPath?.trim() || DEFAULT_LAYOUT_LOGO_PATH,
        itemRows: undefined,
        dataKey: undefined,
        leftDataKey: undefined,
        rightDataKey: undefined,
      });
      return;
    }
    if (nextType === "separator") {
      updateBlock(index, {
        kind: "separator",
        logoPath: undefined,
        separatorChar: block.separatorChar ?? "-",
        itemRows: undefined,
        dataKey: undefined,
        leftDataKey: undefined,
        rightDataKey: undefined,
      });
      return;
    }
    if (nextType === "items") {
      const inferred = inferLineKeys(block);
      const keepTwoCols = lineHasTwoColumns(block);
      if (keepTwoCols) {
        const styles = rowColumnSettings(block);
        updateBlock(index, {
          kind: "items_template",
          logoPath: undefined,
          itemRows: [
            {
              id: makeId("itemrow"),
              leftDataKey:
                isItemDataKey(inferred.left) || inferred.left === FREE_TEXT_KEY || inferred.left === BLANK_LINE_KEY
                  ? inferred.left
                  : "item_qty_price",
              rightDataKey:
                isItemDataKey(inferred.right) || inferred.right === FREE_TEXT_KEY || inferred.right === BLANK_LINE_KEY
                  ? inferred.right
                  : "item_total",
              leftText: block.leftText,
              rightText: block.rightText,
              leftTabCount: block.leftTabCount ?? block.tabCount ?? 0,
              rightTabCount: block.rightTabCount ?? 0,
              leftPrefix: block.leftPrefix ?? block.prefix ?? "",
              leftSuffix: block.leftSuffix ?? block.suffix ?? "",
              rightPrefix: block.rightPrefix ?? "",
              rightSuffix: block.rightSuffix ?? "",
              leftAlign: styles.leftAlign,
              rightAlign: styles.rightAlign,
              leftSize: styles.leftSize,
              rightSize: styles.rightSize,
              leftBold: styles.leftBold,
              rightBold: styles.rightBold,
            },
          ],
          dataKey: undefined,
          leftDataKey: undefined,
          rightDataKey: undefined,
          leftAlign: undefined,
          rightAlign: undefined,
          leftSize: undefined,
          rightSize: undefined,
          leftBold: undefined,
          rightBold: undefined,
        });
        return;
      }
      updateBlock(index, {
        kind: "items_template",
        logoPath: undefined,
        itemRows: [
            {
              id: makeId("itemrow"),
            dataKey:
              isItemDataKey(inferred.single) || inferred.single === FREE_TEXT_KEY || inferred.single === BLANK_LINE_KEY
                ? inferred.single
                : "item_name",
            text: block.text,
            tabCount: block.tabCount ?? 0,
            prefix: block.prefix ?? "",
            suffix: block.suffix ?? "",
            align: block.align ?? "left",
            size: block.size ?? "normal",
            bold: block.bold ?? false,
          },
        ],
        dataKey: undefined,
        align: block.align ?? "left",
        size: block.size ?? "normal",
        bold: block.bold ?? false,
        leftDataKey: undefined,
        rightDataKey: undefined,
      });
      return;
    }

    const inferred = inferLineKeys(block);
    const toTwoCols = lineHasTwoColumns(block);
    if (toTwoCols) {
      const styles = rowColumnSettings(block);
      updateBlock(index, {
        kind: "row_2col",
        logoPath: undefined,
        itemRows: undefined,
        leftDataKey: inferred.left,
        rightDataKey: inferred.right,
        leftText: block.leftText,
        rightText: block.rightText,
        leftTabCount: block.leftTabCount ?? block.tabCount ?? 0,
        rightTabCount: block.rightTabCount ?? 0,
        leftPrefix: block.leftPrefix ?? block.prefix ?? "",
        leftSuffix: block.leftSuffix ?? block.suffix ?? "",
        rightPrefix: block.rightPrefix ?? "",
        rightSuffix: block.rightSuffix ?? "",
        dataKey: undefined,
        leftAlign: styles.leftAlign,
        rightAlign: styles.rightAlign,
        leftSize: styles.leftSize,
        rightSize: styles.rightSize,
        leftBold: styles.leftBold,
        rightBold: styles.rightBold,
      });
      return;
    }
    updateBlock(index, {
      kind: "data",
      logoPath: undefined,
      itemRows: undefined,
      dataKey: inferred.single,
      text: block.text ?? block.leftText ?? "",
      tabCount: block.tabCount ?? block.leftTabCount ?? 0,
      prefix: block.prefix ?? block.leftPrefix ?? "",
      suffix: block.suffix ?? block.leftSuffix ?? "",
      align: block.align ?? "left",
      size: block.size ?? "normal",
      bold: block.bold ?? false,
      leftDataKey: undefined,
      rightDataKey: undefined,
    });
  };

  const handleChangeActiveLayout = (nextId: string) => {
    if (nextId === activeLayoutId) return;
    if (hasUnsavedChanges && !window.confirm("Existem mudanças não salvas neste preset. Deseja sair sem salvar?")) return;
    setActiveLayoutId(nextId);
    setSelectedBlockId(null);
  };

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

  const buildTestTicket = useCallback(async () => {
    const nl = "\n";
    const out: string[] = [];
    for (const block of activeLayout.blocks) {
      const lines = previewLinesForBlock(block, sampleOrder);
      for (const line of lines) {
        if (line.type === "logo") {
          try {
            out.push(await buildEscPosRasterLogo(line.logoPath || DEFAULT_LAYOUT_LOGO_PATH));
            out.push(nl);
          } catch {
            // logo opcional no teste
          }
          continue;
        }
        if (line.type === "row_2col") {
          const formatted = formatRow2ColForOutput(line);
          const sharedBold = line.leftBold === line.rightBold ? line.leftBold : line.leftBold || line.rightBold;
          out.push(escPosAlignCommand("left"));
          out.push(SIZE_TO_ESC[formatted.sharedSize]);
          out.push(sharedBold ? "\x1B\x45\x01" : "\x1B\x45\x00");
          out.push(`${formatted.leftText}${formatted.gap}${formatted.rightText}${nl}`);
          continue;
        }
        const bold = line.bold ?? block.bold ?? false;
        const formattedLine = formatTextLineForOutput(line, block.align ?? "left", block.size ?? "normal");
        const effectiveAlign = formattedLine.align === "justify" ? "left" : formattedLine.align;
        out.push(escPosAlignCommand(effectiveAlign));
        out.push(SIZE_TO_ESC[formattedLine.size]);
        out.push(bold ? "\x1B\x45\x01" : "\x1B\x45\x00");
        out.push(`${formattedLine.printable}${nl}`);
      }
      out.push(escPosAlignCommand("left"));
      out.push(SIZE_TO_ESC.normal);
      out.push("\x1B\x45\x00");
    }
    out.push(`${nl}${nl}`);
    out.push("\x1D\x56\x41\x10");
    return out.join("");
  }, [activeLayout, sampleOrder]);

  const handlePrintTest = useCallback(async () => {
    setTestPrintBusy(true);
    setTestPrintError("");
    try {
      const qz = await loadQz();
      await configureQzSecurity(qz);
      if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 2, delay: 1 });
      const printerName = await resolveQzPrinter(qz);
      const config = qz.configs.create(printerName, { encoding: "ISO-8859-1", copies: 1 });
      const testTicket = await buildTestTicket();
      await qz.print(config, [{ type: "raw", format: "command", flavor: "plain", data: testTicket }]);
    } catch (error) {
      setTestPrintError(error instanceof Error ? error.message : "Falha na impressão-teste.");
    } finally {
      setTestPrintBusy(false);
    }
  }, [buildTestTicket, configureQzSecurity, loadQz, resolveQzPrinter]);

  return (
    <div style={page}>
      <style>{`${internalFocusStyle}`}</style>
      <div style={{ maxWidth: 1360, margin: "0 auto", display: "grid", gap: 12 }}>
        <div style={headerCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22 }}>Layouts de Impressao</h1>
              <div style={small}>Monte o ticket visual e use o layout na impressao real via QZ.</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href="/admin?tab=settings&settingsTab=impressao" style={{ ...btn, textDecoration: "none" }}>
                Voltar para Impressao
              </Link>
              <Link href="/admin/pedidos" style={{ ...btn, textDecoration: "none" }}>
                Ir para Pedidos
              </Link>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
          <div style={{ ...card, position: "sticky", top: 12, alignSelf: "start", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 20 }}>
              <div style={{ ...small, fontWeight: 700 }}>
                Preview (32 colunas + margens visuais)
              </div>
              {hasUnsavedChanges ? <span style={{ ...small, color: "#b54708", fontWeight: 700 }}>Mudanças não salvas</span> : null}
              {saveFeedback ? <span style={{ ...small, color: "#067647", fontWeight: 700 }}>{saveFeedback}</span> : null}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={activeLayout.id}
                onChange={(e) => handleChangeActiveLayout(e.target.value)}
                style={{ ...btn, fontWeight: 500, minWidth: 220, padding: "4px 8px", fontSize: 12 }}
              >
                {layouts.map((layout) => (
                  <option key={layout.id} value={layout.id}>{layout.name}</option>
                ))}
              </select>
              <input
                value={activeLayout.name}
                onChange={(e) => updateActiveLayout((layout) => ({ ...layout, name: e.target.value }))}
                style={{ ...btn, minWidth: 180, fontWeight: 500, padding: "4px 8px", fontSize: 12 }}
                placeholder="Nome do layout"
              />
              <button style={{ ...btn, padding: "4px 8px", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }} onClick={createLayout} title="Novo layout">
                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>add</span>
              </button>
              <button style={{ ...btn, padding: "4px 8px", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }} onClick={duplicateLayout} title="Duplicar layout">
                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>content_copy</span>
              </button>
              <button style={{ ...btn, padding: "4px 8px", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }} onClick={removeLayout} disabled={layouts.length <= 1} title="Excluir layout">
                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>delete</span>
              </button>
              <button style={{ ...btn, padding: "4px 8px", fontSize: 12, display: "inline-flex", gap: 4, alignItems: "center" }} onClick={addBlock}>
                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>add</span>
                Linha
              </button>
              <div style={{ display: "inline-flex", gap: 4, alignItems: "center", marginLeft: 4 }}>
                <span style={{ ...small, fontWeight: 700 }}>Escala</span>
                {PREVIEW_SCALE_OPTIONS.map((scale) => (
                  <button
                    key={scale}
                    style={{ ...btn, padding: "4px 6px", fontSize: 12, background: previewScale === scale ? "var(--pillActive)" : "white" }}
                    onClick={() => setPreviewScale(scale)}
                  >
                    {scale.toFixed(2).replace(/\.00$/, "")}x
                  </button>
                ))}
              </div>
              <div style={{ display: "inline-flex", gap: 4, alignItems: "center", marginLeft: 4 }}>
                <span style={{ ...small, fontWeight: 700 }}>Char</span>
                {PREVIEW_CHAR_CELL_OPTIONS.map((charPx) => (
                  <button
                    key={charPx}
                    style={{ ...btn, padding: "4px 6px", fontSize: 12, background: previewCharCellPx === charPx ? "var(--pillActive)" : "white" }}
                    onClick={() => setPreviewCharCellPx(charPx)}
                    title={`Largura de caractere: ${charPx}px`}
                  >
                    {charPx.toFixed(1)}
                  </button>
                ))}
              </div>
              <div style={{ display: "inline-flex", gap: 4, alignItems: "center", marginLeft: 4 }}>
                <span style={{ ...small, fontWeight: 700 }}>Fonte</span>
                {PREVIEW_FONT_PROFILES.map((profile) => (
                  <button
                    key={profile.id}
                    style={{ ...btn, padding: "4px 6px", fontSize: 12, background: previewFontProfile === profile.id ? "var(--pillActive)" : "white" }}
                    onClick={() => setPreviewFontProfile(profile.id)}
                    title={`Perfil visual: ${profile.label}`}
                  >
                    {profile.label}
                  </button>
                ))}
              </div>
              <button
                style={{ ...btn, padding: "4px 8px", fontSize: 12, background: showGuides ? "var(--pillActive)" : "white" }}
                onClick={() => setShowGuides((current) => !current)}
                title="Mostrar/ocultar guias de edição"
              >
                {showGuides ? "Guias on" : "Guias off"}
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
              <div style={{ display: "inline-flex", alignItems: "flex-start", gap: 12 }}>
              <div
                onClick={() => setSelectedBlockId(null)}
                style={{
                  width: previewTicketWidthPx,
                  boxSizing: "border-box",
                  transform: `scale(${previewScale})`,
                  transformOrigin: "top center",
                  maxWidth: "100%",
                  background: "#fff",
                  border: "1px dashed var(--border)",
                  borderRadius: 10,
                  padding: `${PREVIEW_VERTICAL_PADDING_PX}px ${PREVIEW_SIDE_PADDING_PX}px`,
                  minHeight: 480,
                  fontFamily: previewFontFamily,
                  fontWeight: previewBaseWeight,
                  whiteSpace: "normal",
                  color: "#111",
                }}
              >
                <div
                  style={{
                    width: previewTicketContentWidthPx,
                    maxWidth: "100%",
                    margin: "0 auto",
                    boxSizing: "border-box",
                  }}
                >
                {activeLayout.blocks.map((block, index) => {
                const blockLines = previewLinesForBlock(block, sampleOrder);
                const active = selectedBlockId === block.id;
                const dropTarget = dropTargetBlockId === block.id && draggingBlockId !== null && draggingBlockId !== block.id;
                return (
                  <div
                    key={block.id}
                    draggable
                    style={{
                      position: "relative",
                      outline: showGuides && active ? "1px dashed #9fb8d8" : "1px dashed transparent",
                      outlineOffset: -1,
                      borderRadius: 6,
                      padding: "2px 0",
                      marginBottom: 2,
                      background: showGuides && dropTarget ? "rgba(125,166,216,0.14)" : undefined,
                      cursor: "grab",
                      width: "100%",
                      boxSizing: "border-box",
                      overflow: "visible",
                      zIndex: active ? 2 : 1,
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedBlockId((current) => (current === block.id ? null : block.id));
                    }}
                    onDragStart={(event) => {
                      setDraggingBlockId(block.id);
                      setDropTargetBlockId(block.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", block.id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      if (dropTargetBlockId !== block.id) setDropTargetBlockId(block.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!draggingBlockId) return;
                      const fromIndex = activeLayout.blocks.findIndex((item) => item.id === draggingBlockId);
                      const toIndex = activeLayout.blocks.findIndex((item) => item.id === block.id);
                      moveBlockTo(fromIndex, toIndex);
                      setDraggingBlockId(null);
                      setDropTargetBlockId(null);
                    }}
                    onDragEnd={() => {
                      setDraggingBlockId(null);
                      setDropTargetBlockId(null);
                    }}
                  >
                    {blockLines.map((line, pvIndex) => {
                      if (line.type === "logo") {
                        const previewLogoPath = line.logoPath?.trim() || DEFAULT_LAYOUT_LOGO_PATH;
                        return (
                          <div key={`pv_${index}_${pvIndex}`} style={{ textAlign: "center", marginBottom: 4 }}>
                            <img
                              src={previewLogoPath}
                              alt="Logo"
                              style={{
                                width: "66%",
                                maxWidth: 160,
                                height: "auto",
                                objectFit: "contain",
                                display: "inline-block",
                                background: "#fff",
                                filter: "grayscale(100%) contrast(1000%)",
                              }}
                            />
                          </div>
                        );
                      }

                      if (line.type === "row_2col") {
                        const formatted = formatRow2ColForOutput(line);
                        const leftUsedColumns = lineColumns(normalizeSingleLinePreservePadding(line.leftText));
                        const rightUsedColumns = lineColumns(normalizeSingleLinePreservePadding(line.rightText));
                        const leftMaxColumns = formatted.widths.leftWidth;
                        const rightMaxColumns = formatted.widths.rightWidth;
                        const leftOverflowBy = line.leftStrictWidth ? formatted.widths.leftOverflowBy : 0;
                        const rightOverflowBy = line.rightStrictWidth ? formatted.widths.rightOverflowBy : 0;
                        const isOverflow = leftOverflowBy > 0 || rightOverflowBy > 0;
                        const showOverflowAlert = isOverflow && block.kind !== "separator";
                        const sharedBold = line.leftBold === line.rightBold ? line.leftBold : line.leftBold || line.rightBold;
                        const printableRow = `${formatted.leftText}${formatted.gap}${formatted.rightText}`;
                        const overflowParts: string[] = [];
                        if (leftOverflowBy > 0) overflowParts.push(`Esq ${leftUsedColumns}/${leftMaxColumns} (+${leftOverflowBy})`);
                        if (rightOverflowBy > 0) overflowParts.push(`Dir ${rightUsedColumns}/${rightMaxColumns} (+${rightOverflowBy})`);
                        return (
                          <div key={`pv_${index}_${pvIndex}`} style={{ marginBottom: showOverflowAlert ? 3 : 0 }}>
                            <div
                              style={{
                                width: "100%",
                                maxWidth: "100%",
                                boxSizing: "border-box",
                                overflow: "hidden",
                                fontWeight: sharedBold ? 700 : previewBaseWeight,
                                fontSize:
                                  (formatted.sharedSize === "3x" ? 32 : formatted.sharedSize === "2x" ? 22 : 12) * previewFontScale,
                                lineHeight: 1.25,
                                letterSpacing: `${previewLetterSpacingPx}px`,
                                textAlign: "left",
                                whiteSpace: "pre",
                                background: showOverflowAlert ? "rgba(208, 41, 68, 0.11)" : undefined,
                                outline: showOverflowAlert ? "1px solid rgba(208, 41, 68, 0.5)" : undefined,
                                borderRadius: showOverflowAlert ? 4 : undefined,
                                padding: showOverflowAlert ? "1px 2px" : 0,
                              }}
                            >
                              {printableRow ? previewVisibleSpaces(printableRow) : "\u00a0"}
                            </div>
                            {showOverflowAlert ? (
                              <div style={{ ...small, color: "#b42318", fontSize: 10, lineHeight: 1.2 }}>
                                Excede largura: {overflowParts.join(" | ")}
                              </div>
                            ) : null}
                          </div>
                        );
                      }

                      const formattedLine = formatTextLineForOutput(line, block.align ?? "left", block.size ?? "normal");
                      const maxColumns = formattedLine.maxColumns;
                      const usedColumns = formattedLine.usedColumns;
                      const overflowBy = formattedLine.overflowBy;
                      const isOverflow = (Boolean(line.strictWidth) && overflowBy > 0) || Boolean(line.overflowHint);
                      const effectiveOverflow = overflowBy > 0 ? overflowBy : line.overflowColumns ?? 0;
                      const showOverflowAlert = isOverflow && block.kind !== "separator";
                      const previewText = formattedLine.printable;
                      return (
                        <div key={`pv_${index}_${pvIndex}`} style={{ marginBottom: showOverflowAlert ? 3 : 0 }}>
                          <div
                            style={{
                              fontWeight: line.bold ? 700 : previewBaseWeight,
                              fontSize: (line.size === "3x" ? 32 : line.size === "2x" ? 22 : 12) * previewFontScale,
                              lineHeight: 1.25,
                              letterSpacing: `${previewLetterSpacingPx}px`,
                              textAlign: formattedLine.align === "justify" ? "left" : formattedLine.align,
                              whiteSpace: line.strictWidth ? "pre" : "pre-wrap",
                              overflowWrap: "normal",
                              wordBreak: "normal",
                              width: "100%",
                              maxWidth: "100%",
                              boxSizing: "border-box",
                              overflow: line.strictWidth ? "hidden" : "visible",
                              display: line.composedRight ? "flex" : "block",
                              alignItems: line.composedRight ? "baseline" : undefined,
                              background: showOverflowAlert ? "rgba(208, 41, 68, 0.11)" : undefined,
                              outline: showOverflowAlert ? "1px solid rgba(208, 41, 68, 0.5)" : undefined,
                              borderRadius: showOverflowAlert ? 4 : undefined,
                              padding: showOverflowAlert ? "1px 2px" : 0,
                            }}
                          >
                            {line.composedRight ? (
                              <>
                                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {line.composedLeft ? previewVisibleSpaces(line.composedLeft) : "\u00a0"}
                                </span>
                                <span style={{ marginLeft: "auto", whiteSpace: "nowrap", paddingLeft: 6 }}>
                                  {previewVisibleSpaces(line.composedRight)}
                                </span>
                              </>
                            ) : (
                              previewText ? previewVisibleSpaces(previewText) : "\u00a0"
                            )}
                          </div>
                          {showOverflowAlert ? (
                            <div style={{ ...small, color: "#b42318", fontSize: 10, lineHeight: 1.2 }}>
                              Excede largura: {usedColumns}/{maxColumns} colunas (+{effectiveOverflow})
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
                })}
                </div>
              </div>
              <div style={{ display: "grid", gap: 8, marginBottom: 4 }}>
                <button
                  style={{
                    ...btn,
                    width: 40,
                    height: 40,
                    borderRadius: 999,
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                  onClick={() => void handlePrintTest()}
                  disabled={testPrintBusy}
                  title={testPrintBusy ? "Imprimindo teste..." : "Impressão-teste"}
                  aria-label="Impressão-teste"
                >
                  <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 20, lineHeight: 1 }}>
                    {testPrintBusy ? "autorenew" : "print"}
                  </span>
                </button>
                <button
                  style={{
                    ...btn,
                    width: 40,
                    height: 40,
                    borderRadius: 999,
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                    background: hasUnsavedChanges ? "var(--pillActive)" : "var(--pill)",
                  }}
                  onClick={saveChanges}
                  title="Salvar mudanças"
                  aria-label="Salvar mudanças"
                >
                  <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 20, lineHeight: 1 }}>
                    save
                  </span>
                </button>
              </div>
              <div
                style={{
                  width: lineEditorWidth,
                  maxWidth: lineEditorWidth,
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 8,
                  boxShadow: "0 6px 14px rgba(0,0,0,0.08)",
                  display: "grid",
                  gap: 6,
                  overflowX: "hidden",
                  boxSizing: "border-box",
                }}
              >
                {editingBlock ? (
                  <>
                    <div style={{ ...small, fontWeight: 700 }}>
                      Linha {editingBlockIndex + 1}: {blockLabel(editingBlock.kind)}
                    </div>
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={{ ...small, fontWeight: 700 }}>Tipo da linha</div>
                      <select
                        value={lineEditorType(editingBlock)}
                        onChange={(e) => setLineType(editingBlockIndex, editingBlock, e.target.value as LineEditorType)}
                        style={{ ...btn, padding: "3px 6px", fontWeight: 500, fontSize: 12 }}
                      >
                        {LINE_TYPE_OPTIONS.map((option) => (
                          <option key={`panel_line_type_${option.value}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <div style={{ ...small, fontSize: 11, color: "#475467" }}>
                        {editingBlock.kind === "items_template" || editingBlock.kind === "items"
                          ? "ESC/POS: configure por linha do template"
                          : lineHasTwoColumns(editingBlock)
                            ? `ESC/POS: Esq ${escPosSizeLabel(editingBlock.leftSize ?? editingBlock.size ?? "normal")} | Dir ${escPosSizeLabel(editingBlock.rightSize ?? editingBlock.size ?? "normal")}`
                            : `ESC/POS: ${escPosSizeLabel(editingBlock.size ?? "normal")}`}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Mover para cima" onClick={() => moveBlock(editingBlockIndex, -1)} disabled={editingBlockIndex === 0}>
                        <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>arrow_upward</span>
                      </button>
                      <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Mover para baixo" onClick={() => moveBlock(editingBlockIndex, 1)} disabled={editingBlockIndex === activeLayout.blocks.length - 1}>
                        <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>arrow_downward</span>
                      </button>
                      <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Remover linha" onClick={() => removeBlock(editingBlockIndex)} disabled={activeLayout.blocks.length <= 1}>
                        <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>delete</span>
                      </button>
                    </div>
                    {hasTextField(editingBlock) ? (
                      <input
                        value={editingBlock.text ?? ""}
                        onChange={(e) => updateBlock(editingBlockIndex, { text: e.target.value })}
                        placeholder={editingBlock.kind === "total" ? "TOTAL" : "Texto"}
                        style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                      />
                    ) : null}
                    {editingBlock.kind === "separator" ? (
                      <input
                        value={editingBlock.separatorChar ?? "-"}
                        onChange={(e) => updateBlock(editingBlockIndex, { separatorChar: e.target.value })}
                        placeholder="-"
                        style={{ ...btn, width: 90, fontWeight: 500, fontSize: 12 }}
                      />
                    ) : null}
                    {editingBlock.kind === "logo" ? (
                      <div style={{ display: "grid", gap: 4 }}>
                        <div style={{ ...small, fontWeight: 700 }}>Logo do preset</div>
                        <input
                          value={editingBlock.logoPath ?? DEFAULT_LAYOUT_LOGO_PATH}
                          onChange={(e) => updateBlock(editingBlockIndex, { logoPath: e.target.value })}
                          placeholder="Caminho/URL do logo (PNG/SVG)"
                          style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                        />
                      </div>
                    ) : null}
                    {supportsLineDataEditor(editingBlock) ? (
                      (() => {
                        const inferred = inferLineKeys(editingBlock);
                        const selectableDataGroups = editingBlock.kind === "items_template" || editingBlock.kind === "items" ? ITEM_DATA_KEY_GROUPS : DATA_KEY_GROUPS;
                        const dataCount = lineDataCount(editingBlock);
                        const leftAlign = editingBlock.leftAlign ?? editingBlock.align ?? "left";
                        const rightAlign = editingBlock.rightAlign ?? (editingBlock.align === "center" ? "center" : "right");
                        const leftSize = editingBlock.leftSize ?? editingBlock.size ?? "normal";
                        const rightSize = editingBlock.rightSize ?? editingBlock.size ?? "normal";
                        const leftBold = editingBlock.leftBold ?? editingBlock.bold ?? false;
                        const rightBold = editingBlock.rightBold ?? editingBlock.bold ?? false;
                        if (editingBlock.kind === "items_template" || editingBlock.kind === "items") {
                          const rows = getItemRowsForEditing(editingBlock);
                          return (
                            <div style={{ display: "grid", gap: 8 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <div style={{ ...small, fontWeight: 700 }}>Template do item</div>
                                <button
                                  style={{ ...btn, padding: "2px 5px", fontWeight: 700, fontSize: 12, lineHeight: 1 }}
                                  onClick={() => addItemTemplateRow(editingBlockIndex, editingBlock)}
                                  title="Adicionar linha no item"
                                >
                                  <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>add</span>
                                </button>
                              </div>
                              {rows.map((row, rowIndex) => {
                                const rowTwoCols = itemRowHasTwoColumns(row);
                                const rowDataCount = rowTwoCols ? 2 : 1;
                                const rowLeftAlign = row.leftAlign ?? row.align ?? "left";
                                const rowRightAlign = row.rightAlign ?? (row.align === "center" ? "center" : "right");
                                const rowLeftSize = row.leftSize ?? row.size ?? "normal";
                                const rowRightSize = row.rightSize ?? row.size ?? "normal";
                                const rowLeftBold = row.leftBold ?? row.bold ?? false;
                                const rowRightBold = row.rightBold ?? row.bold ?? false;
                                const rowSingle =
                                  isItemDataKey(row.dataKey) || row.dataKey === FREE_TEXT_KEY || row.dataKey === BLANK_LINE_KEY
                                    ? (row.dataKey ?? "item_name")
                                    : "item_name";
                                const rowLeft =
                                  isItemDataKey(row.leftDataKey) || row.leftDataKey === FREE_TEXT_KEY || row.leftDataKey === BLANK_LINE_KEY
                                    ? (row.leftDataKey ?? "item_qty_price")
                                    : "item_qty_price";
                                const rowRight =
                                  isItemDataKey(row.rightDataKey) || row.rightDataKey === FREE_TEXT_KEY || row.rightDataKey === BLANK_LINE_KEY
                                    ? (row.rightDataKey ?? "item_total")
                                    : "item_total";
                                return (
                                  <div key={row.id} style={{ display: "grid", gap: 6, border: "1px solid var(--border)", borderRadius: 8, padding: 6 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <div style={{ ...small, fontWeight: 700 }}>Linha do item {rowIndex + 1}</div>
                                      <button
                                        style={{ ...btn, padding: "2px 5px", fontWeight: 700, fontSize: 12, lineHeight: 1 }}
                                        onClick={() => setItemTemplateRowDataCount(editingBlockIndex, editingBlock, rowIndex, rowDataCount - 1)}
                                        disabled={rowDataCount <= 1}
                                        title="Remover coluna/dado"
                                      >
                                        <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>remove</span>
                                      </button>
                                      <span style={{ ...small, minWidth: 14, textAlign: "center", fontWeight: 700 }}>{rowDataCount}</span>
                                      <button
                                        style={{ ...btn, padding: "2px 5px", fontWeight: 700, fontSize: 12, lineHeight: 1 }}
                                        onClick={() => setItemTemplateRowDataCount(editingBlockIndex, editingBlock, rowIndex, rowDataCount + 1)}
                                        disabled={rowDataCount >= 2}
                                        title="Adicionar coluna/dado"
                                      >
                                        <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>add</span>
                                      </button>
                                      <button
                                        style={{ ...btn, padding: "2px 5px", fontWeight: 700, fontSize: 12, lineHeight: 1, marginLeft: "auto" }}
                                        onClick={() => removeItemTemplateRow(editingBlockIndex, editingBlock, rowIndex)}
                                        disabled={rows.length <= 1}
                                        title="Remover linha do item"
                                      >
                                        <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>delete</span>
                                      </button>
                                    </div>
                                    {rowTwoCols ? (
                                      <div style={{ display: "grid", gap: 8 }}>
                                        <div style={{ display: "grid", gap: 4 }}>
                                          <div style={{ ...small, fontWeight: 700 }}>Coluna esquerda</div>
                                          <select
                                            value={rowLeft}
                                            onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftDataKey: e.target.value as PrintDataKey })}
                                            style={{ ...btn, padding: "3px 6px", fontWeight: 500, fontSize: 12 }}
                                          >
                                            {ITEM_DATA_KEY_GROUPS.map((group) => (
                                              <optgroup key={`item_row_left_${row.id}_${group.label}`} label={group.label}>
                                                {group.keys.map((key) => (
                                                  <option key={`item_row_left_${row.id}_${key}`} value={key}>
                                                    {DATA_KEY_LABEL[key]}
                                                  </option>
                                                ))}
                                              </optgroup>
                                            ))}
                                          </select>
                                          {rowLeft === FREE_TEXT_KEY ? (
                                            <input
                                              value={row.leftText ?? ""}
                                              onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftText: e.target.value })}
                                              placeholder={dataKeyPlaceholder(rowLeft)}
                                              style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                            />
                                          ) : null}
                                          <div style={{ display: "grid", gridTemplateColumns: "56px minmax(0,1fr) minmax(0,1fr)", width: "100%", maxWidth: "100%", gap: 6 }}>
                                            <input
                                              type="number"
                                              min={0}
                                              max={12}
                                              value={row.leftTabCount ?? 0}
                                              onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftTabCount: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })}
                                              placeholder={`Tab ${dataKeyPlaceholder(rowLeft)}`}
                                              style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                            />
                                            <input
                                              value={row.leftPrefix ?? ""}
                                              onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftPrefix: e.target.value })}
                                              placeholder={`Prefixo ${dataKeyPlaceholder(rowLeft)}`}
                                              style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                            />
                                            <input
                                              value={row.leftSuffix ?? ""}
                                              onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftSuffix: e.target.value })}
                                              placeholder={`Sufixo ${dataKeyPlaceholder(rowLeft)}`}
                                              style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                            />
                                          </div>
                                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                            <div style={{ display: "inline-flex", gap: 4 }}>
                                              {ALIGN_OPTIONS.map((align) => (
                                                <button
                                                  key={`item_row_left_align_${row.id}_${align}`}
                                                  style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12, background: rowLeftAlign === align ? "var(--pillActive)" : "white" }}
                                                  title={`${ALIGN_LABEL[align]} (coluna esquerda)`}
                                                  onClick={() => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftAlign: align })}
                                                >
                                                  <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>{ALIGN_ICON[align]}</span>
                                                </button>
                                              ))}
                                            </div>
                                            <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Diminuir fonte da coluna esquerda" onClick={() => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftSize: sizeStep(rowLeftSize, -1) })}>
                                              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_decrease</span>
                                            </button>
                                            <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Aumentar fonte da coluna esquerda" onClick={() => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftSize: sizeStep(rowLeftSize, 1) })}>
                                              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_increase</span>
                                            </button>
                                            <span style={{ ...small, fontSize: 11, color: "#475467" }}>ESC/POS {escPosSizeLabel(rowLeftSize)}</span>
                                            <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12, background: rowLeftBold ? "var(--pillActive)" : "white" }} onClick={() => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftBold: !rowLeftBold })} title="Negrito na coluna esquerda">
                                              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>format_bold</span>
                                            </button>
                                          </div>
                                        </div>
                                        <div style={{ display: "grid", gap: 4, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
                                          <div style={{ ...small, fontWeight: 700 }}>Coluna direita</div>
                                          <select
                                            value={rowRight}
                                            onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightDataKey: e.target.value as PrintDataKey })}
                                            style={{ ...btn, padding: "3px 6px", fontWeight: 500, fontSize: 12 }}
                                          >
                                            {ITEM_DATA_KEY_GROUPS.map((group) => (
                                              <optgroup key={`item_row_right_${row.id}_${group.label}`} label={group.label}>
                                                {group.keys.map((key) => (
                                                  <option key={`item_row_right_${row.id}_${key}`} value={key}>
                                                    {DATA_KEY_LABEL[key]}
                                                  </option>
                                                ))}
                                              </optgroup>
                                            ))}
                                          </select>
                                          {rowRight === FREE_TEXT_KEY ? (
                                            <input
                                              value={row.rightText ?? ""}
                                              onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightText: e.target.value })}
                                              placeholder={dataKeyPlaceholder(rowRight)}
                                              style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                            />
                                          ) : null}
                                          <div style={{ display: "grid", gridTemplateColumns: "56px minmax(0,1fr) minmax(0,1fr)", width: "100%", maxWidth: "100%", gap: 6 }}>
                                            <input
                                              type="number"
                                              min={0}
                                              max={12}
                                              value={row.rightTabCount ?? 0}
                                              onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightTabCount: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })}
                                              placeholder={`Tab ${dataKeyPlaceholder(rowRight)}`}
                                              style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                            />
                                            <input
                                              value={row.rightPrefix ?? ""}
                                              onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightPrefix: e.target.value })}
                                              placeholder={`Prefixo ${dataKeyPlaceholder(rowRight)}`}
                                              style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                            />
                                            <input
                                              value={row.rightSuffix ?? ""}
                                              onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightSuffix: e.target.value })}
                                              placeholder={`Sufixo ${dataKeyPlaceholder(rowRight)}`}
                                              style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                            />
                                          </div>
                                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                            <div style={{ display: "inline-flex", gap: 4 }}>
                                              {ALIGN_OPTIONS.map((align) => (
                                                <button
                                                  key={`item_row_right_align_${row.id}_${align}`}
                                                  style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12, background: rowRightAlign === align ? "var(--pillActive)" : "white" }}
                                                  title={`${ALIGN_LABEL[align]} (coluna direita)`}
                                                  onClick={() => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightAlign: align })}
                                                >
                                                  <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>{ALIGN_ICON[align]}</span>
                                                </button>
                                              ))}
                                            </div>
                                            <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Diminuir fonte da coluna direita" onClick={() => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightSize: sizeStep(rowRightSize, -1) })}>
                                              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_decrease</span>
                                            </button>
                                            <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Aumentar fonte da coluna direita" onClick={() => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightSize: sizeStep(rowRightSize, 1) })}>
                                              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_increase</span>
                                            </button>
                                            <span style={{ ...small, fontSize: 11, color: "#475467" }}>ESC/POS {escPosSizeLabel(rowRightSize)}</span>
                                            <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12, background: rowRightBold ? "var(--pillActive)" : "white" }} onClick={() => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightBold: !rowRightBold })} title="Negrito na coluna direita">
                                              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>format_bold</span>
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    ) : (
                                      <div style={{ display: "grid", gap: 4 }}>
                                        <div style={{ ...small, fontWeight: 700 }}>Dado</div>
                                        <select
                                          value={rowSingle}
                                          onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { dataKey: e.target.value as PrintDataKey })}
                                          style={{ ...btn, padding: "3px 6px", fontWeight: 500, fontSize: 12 }}
                                        >
                                          {ITEM_DATA_KEY_GROUPS.map((group) => (
                                            <optgroup key={`item_row_single_${row.id}_${group.label}`} label={group.label}>
                                              {group.keys.map((key) => (
                                                <option key={`item_row_single_${row.id}_${key}`} value={key}>
                                                  {DATA_KEY_LABEL[key]}
                                                </option>
                                              ))}
                                            </optgroup>
                                          ))}
                                        </select>
                                        {rowSingle === FREE_TEXT_KEY ? (
                                          <input
                                            value={row.text ?? ""}
                                            onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { text: e.target.value })}
                                            placeholder={dataKeyPlaceholder(rowSingle)}
                                            style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                          />
                                        ) : null}
                                        <div style={{ display: "grid", gridTemplateColumns: "56px minmax(0,1fr) minmax(0,1fr)", width: "100%", maxWidth: "100%", gap: 6 }}>
                                          <input
                                            type="number"
                                            min={0}
                                            max={12}
                                            value={row.tabCount ?? 0}
                                            onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { tabCount: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })}
                                            placeholder={`Tab ${dataKeyPlaceholder(rowSingle)}`}
                                            style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                          />
                                          <input
                                            value={row.prefix ?? ""}
                                            onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { prefix: e.target.value })}
                                            placeholder={`Prefixo ${dataKeyPlaceholder(rowSingle)}`}
                                            style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                          />
                                          <input
                                            value={row.suffix ?? ""}
                                            onChange={(e) => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { suffix: e.target.value })}
                                            placeholder={`Sufixo ${dataKeyPlaceholder(rowSingle)}`}
                                            style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                          />
                                        </div>
                                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                          <div style={{ display: "inline-flex", gap: 4 }}>
                                            {ALIGN_OPTIONS.map((align) => (
                                              <button
                                                key={`item_row_single_align_${row.id}_${align}`}
                                                style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12, background: (row.align ?? "left") === align ? "var(--pillActive)" : "white" }}
                                                title={ALIGN_LABEL[align]}
                                                onClick={() => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { align })}
                                              >
                                                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>{ALIGN_ICON[align]}</span>
                                              </button>
                                            ))}
                                          </div>
                                          <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Diminuir fonte" onClick={() => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { size: sizeStep(row.size ?? "normal", -1) })}>
                                            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_decrease</span>
                                          </button>
                                          <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Aumentar fonte" onClick={() => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { size: sizeStep(row.size ?? "normal", 1) })}>
                                            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_increase</span>
                                          </button>
                                          <span style={{ ...small, fontSize: 11, color: "#475467" }}>ESC/POS {escPosSizeLabel(row.size ?? "normal")}</span>
                                          <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12, background: (row.bold ?? false) ? "var(--pillActive)" : "white" }} onClick={() => updateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { bold: !(row.bold ?? false) })} title="Negrito">
                                            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>format_bold</span>
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }
                        return (
                          <div style={{ display: "grid", gap: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <div style={{ ...small, fontWeight: 700 }}>Dados na linha</div>
                              <button
                                style={{ ...btn, padding: "2px 5px", fontWeight: 700, fontSize: 12, lineHeight: 1 }}
                                onClick={() => setLineDataCount(editingBlockIndex, editingBlock, dataCount - 1)}
                                disabled={dataCount <= 1}
                                title="Remover dado da linha"
                              >
                                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>remove</span>
                              </button>
                              <span style={{ ...small, minWidth: 14, textAlign: "center", fontWeight: 700 }}>{dataCount}</span>
                              <button
                                style={{ ...btn, padding: "2px 5px", fontWeight: 700, fontSize: 12, lineHeight: 1 }}
                                onClick={() => setLineDataCount(editingBlockIndex, editingBlock, dataCount + 1)}
                                disabled={dataCount >= 2}
                                title="Adicionar dado na linha"
                              >
                                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>add</span>
                              </button>
                            </div>
                            {dataCount === 1 ? (
                              <div style={{ display: "grid", gap: 4 }}>
                                <div style={{ ...small, fontWeight: 700 }}>Dado</div>
                                <select
                                  value={inferred.single}
                                  onChange={(e) =>
                                    updateBlock(editingBlockIndex, {
                                      kind: "data",
                                      dataKey: e.target.value as PrintDataKey,
                                      leftDataKey: undefined,
                                      rightDataKey: undefined,
                                    })
                                  }
                                  style={{ ...btn, padding: "3px 6px", fontWeight: 500, fontSize: 12 }}
                                >
                                  {selectableDataGroups.map((group) => (
                                    <optgroup key={`panel_data_${group.label}`} label={group.label}>
                                      {group.keys.map((key) => (
                                        <option key={`panel_d_${key}`} value={key}>
                                          {DATA_KEY_LABEL[key]}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </select>
                                {inferred.single === FREE_TEXT_KEY ? (
                                  <input
                                    value={editingBlock.text ?? ""}
                                    onChange={(e) => updateBlock(editingBlockIndex, { text: e.target.value })}
                                    placeholder={dataKeyPlaceholder(inferred.single)}
                                    style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                  />
                                ) : null}
                                <div style={{ display: "grid", gridTemplateColumns: "56px minmax(0,1fr) minmax(0,1fr)", width: "100%", maxWidth: "100%", gap: 6 }}>
                                  <input
                                    type="number"
                                    min={0}
                                    max={12}
                                    value={editingBlock.tabCount ?? 0}
                                    onChange={(e) => updateBlock(editingBlockIndex, { tabCount: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })}
                                    placeholder={`Tab ${dataKeyPlaceholder(inferred.single)}`}
                                    style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                  />
                                  <input
                                    value={editingBlock.prefix ?? ""}
                                    onChange={(e) => updateBlock(editingBlockIndex, { prefix: e.target.value })}
                                    placeholder={`Prefixo ${dataKeyPlaceholder(inferred.single)}`}
                                    style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                  />
                                  <input
                                    value={editingBlock.suffix ?? ""}
                                    onChange={(e) => updateBlock(editingBlockIndex, { suffix: e.target.value })}
                                    placeholder={`Sufixo ${dataKeyPlaceholder(inferred.single)}`}
                                    style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                  />
                                </div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                  <div style={{ display: "inline-flex", gap: 4 }}>
                                    {ALIGN_OPTIONS.map((align) => {
                                      const currentAlign = editingBlock.align ?? "left";
                                      const activeAlign = currentAlign === align;
                                      return (
                                        <button
                                          key={`panel_single_align_${align}`}
                                          style={{
                                            ...btn,
                                            padding: "3px 5px",
                                            fontWeight: 700,
                                            fontSize: 12,
                                            background: activeAlign ? "var(--pillActive)" : "white",
                                          }}
                                          title={ALIGN_LABEL[align]}
                                          onClick={() => updateBlock(editingBlockIndex, { align })}
                                        >
                                          <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
                                            {ALIGN_ICON[align]}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <button
                                    style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }}
                                    title="Diminuir fonte"
                                    onClick={() => updateBlock(editingBlockIndex, { size: sizeStep(editingBlock.size ?? "normal", -1) })}
                                  >
                                    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_decrease</span>
                                  </button>
                                  <button
                                    style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }}
                                    title="Aumentar fonte"
                                    onClick={() => updateBlock(editingBlockIndex, { size: sizeStep(editingBlock.size ?? "normal", 1) })}
                                  >
                                    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_increase</span>
                                  </button>
                                  <span style={{ ...small, fontSize: 11, color: "#475467" }}>ESC/POS {escPosSizeLabel(editingBlock.size ?? "normal")}</span>
                                  <button
                                    style={{
                                      ...btn,
                                      padding: "3px 5px",
                                      fontWeight: 700,
                                      fontSize: 12,
                                      background: (editingBlock.bold ?? false) ? "var(--pillActive)" : "white",
                                    }}
                                    onClick={() => updateBlock(editingBlockIndex, { bold: !(editingBlock.bold ?? false) })}
                                    title="Negrito"
                                  >
                                    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>format_bold</span>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "grid", gap: 8 }}>
                                <div style={{ display: "grid", gap: 4 }}>
                                  <div style={{ ...small, fontWeight: 700 }}>Coluna esquerda</div>
                                  <select
                                    value={inferred.left}
                                    onChange={(e) =>
                                      updateBlock(editingBlockIndex, {
                                        kind: "row_2col",
                                        leftDataKey: e.target.value as PrintDataKey,
                                        rightDataKey: inferred.right,
                                        dataKey: undefined,
                                      })
                                    }
                                    style={{ ...btn, padding: "3px 6px", fontWeight: 500, fontSize: 12 }}
                                  >
                                    {selectableDataGroups.map((group) => (
                                      <optgroup key={`panel_left_${group.label}`} label={group.label}>
                                        {group.keys.map((key) => (
                                          <option key={`panel_l_${key}`} value={key}>
                                            {DATA_KEY_LABEL[key]}
                                          </option>
                                        ))}
                                      </optgroup>
                                    ))}
                                  </select>
                                  {inferred.left === FREE_TEXT_KEY ? (
                                    <input
                                      value={editingBlock.leftText ?? ""}
                                      onChange={(e) => updateBlock(editingBlockIndex, { leftText: e.target.value })}
                                      placeholder={dataKeyPlaceholder(inferred.left)}
                                      style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                    />
                                  ) : null}
                                  <div style={{ display: "grid", gridTemplateColumns: "56px minmax(0,1fr) minmax(0,1fr)", width: "100%", maxWidth: "100%", gap: 6 }}>
                                    <input
                                      type="number"
                                      min={0}
                                      max={12}
                                      value={editingBlock.leftTabCount ?? 0}
                                      onChange={(e) => updateBlock(editingBlockIndex, { leftTabCount: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })}
                                      placeholder={`Tab ${dataKeyPlaceholder(inferred.left)}`}
                                      style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                    />
                                    <input
                                      value={editingBlock.leftPrefix ?? ""}
                                      onChange={(e) => updateBlock(editingBlockIndex, { leftPrefix: e.target.value })}
                                      placeholder={`Prefixo ${dataKeyPlaceholder(inferred.left)}`}
                                      style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                    />
                                    <input
                                      value={editingBlock.leftSuffix ?? ""}
                                      onChange={(e) => updateBlock(editingBlockIndex, { leftSuffix: e.target.value })}
                                      placeholder={`Sufixo ${dataKeyPlaceholder(inferred.left)}`}
                                      style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                    />
                                  </div>
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                    <div style={{ display: "inline-flex", gap: 4 }}>
                                      {ALIGN_OPTIONS.map((align) => {
                                        const activeAlign = leftAlign === align;
                                        return (
                                          <button
                                            key={`panel_left_align_${align}`}
                                            style={{
                                              ...btn,
                                              padding: "3px 5px",
                                              fontWeight: 700,
                                              fontSize: 12,
                                              background: activeAlign ? "var(--pillActive)" : "white",
                                            }}
                                            title={`${ALIGN_LABEL[align]} (coluna esquerda)`}
                                            onClick={() => updateBlock(editingBlockIndex, { leftAlign: align })}
                                          >
                                            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
                                              {ALIGN_ICON[align]}
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <button
                                      style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }}
                                      title="Diminuir fonte da coluna esquerda"
                                      onClick={() => updateBlock(editingBlockIndex, { leftSize: sizeStep(leftSize, -1) })}
                                    >
                                      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_decrease</span>
                                    </button>
                                    <button
                                      style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }}
                                      title="Aumentar fonte da coluna esquerda"
                                      onClick={() => updateBlock(editingBlockIndex, { leftSize: sizeStep(leftSize, 1) })}
                                    >
                                      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_increase</span>
                                    </button>
                                    <span style={{ ...small, fontSize: 11, color: "#475467" }}>ESC/POS {escPosSizeLabel(leftSize)}</span>
                                    <button
                                      style={{
                                        ...btn,
                                        padding: "3px 5px",
                                        fontWeight: 700,
                                        fontSize: 12,
                                        background: leftBold ? "var(--pillActive)" : "white",
                                      }}
                                      onClick={() => updateBlock(editingBlockIndex, { leftBold: !leftBold })}
                                      title="Negrito na coluna esquerda"
                                    >
                                      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>format_bold</span>
                                    </button>
                                  </div>
                                </div>
                                <div style={{ display: "grid", gap: 4, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
                                  <div style={{ ...small, fontWeight: 700 }}>Coluna direita</div>
                                  <select
                                    value={inferred.right}
                                    onChange={(e) =>
                                      updateBlock(editingBlockIndex, {
                                        kind: "row_2col",
                                        rightDataKey: e.target.value as PrintDataKey,
                                        leftDataKey: inferred.left,
                                        dataKey: undefined,
                                      })
                                    }
                                    style={{ ...btn, padding: "3px 6px", fontWeight: 500, fontSize: 12 }}
                                  >
                                    {selectableDataGroups.map((group) => (
                                      <optgroup key={`panel_right_${group.label}`} label={group.label}>
                                        {group.keys.map((key) => (
                                          <option key={`panel_r_${key}`} value={key}>
                                            {DATA_KEY_LABEL[key]}
                                          </option>
                                        ))}
                                      </optgroup>
                                    ))}
                                  </select>
                                  {inferred.right === FREE_TEXT_KEY ? (
                                    <input
                                      value={editingBlock.rightText ?? ""}
                                      onChange={(e) => updateBlock(editingBlockIndex, { rightText: e.target.value })}
                                      placeholder={dataKeyPlaceholder(inferred.right)}
                                      style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                    />
                                  ) : null}
                                  <div style={{ display: "grid", gridTemplateColumns: "56px minmax(0,1fr) minmax(0,1fr)", width: "100%", maxWidth: "100%", gap: 6 }}>
                                    <input
                                      type="number"
                                      min={0}
                                      max={12}
                                      value={editingBlock.rightTabCount ?? 0}
                                      onChange={(e) => updateBlock(editingBlockIndex, { rightTabCount: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })}
                                      placeholder={`Tab ${dataKeyPlaceholder(inferred.right)}`}
                                      style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                    />
                                    <input
                                      value={editingBlock.rightPrefix ?? ""}
                                      onChange={(e) => updateBlock(editingBlockIndex, { rightPrefix: e.target.value })}
                                      placeholder={`Prefixo ${dataKeyPlaceholder(inferred.right)}`}
                                      style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                    />
                                    <input
                                      value={editingBlock.rightSuffix ?? ""}
                                      onChange={(e) => updateBlock(editingBlockIndex, { rightSuffix: e.target.value })}
                                      placeholder={`Sufixo ${dataKeyPlaceholder(inferred.right)}`}
                                      style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                    />
                                  </div>
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                    <div style={{ display: "inline-flex", gap: 4 }}>
                                      {ALIGN_OPTIONS.map((align) => {
                                        const activeAlign = rightAlign === align;
                                        return (
                                          <button
                                            key={`panel_right_align_${align}`}
                                            style={{
                                              ...btn,
                                              padding: "3px 5px",
                                              fontWeight: 700,
                                              fontSize: 12,
                                              background: activeAlign ? "var(--pillActive)" : "white",
                                            }}
                                            title={`${ALIGN_LABEL[align]} (coluna direita)`}
                                            onClick={() => updateBlock(editingBlockIndex, { rightAlign: align })}
                                          >
                                            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
                                              {ALIGN_ICON[align]}
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <button
                                      style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }}
                                      title="Diminuir fonte da coluna direita"
                                      onClick={() => updateBlock(editingBlockIndex, { rightSize: sizeStep(rightSize, -1) })}
                                    >
                                      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_decrease</span>
                                    </button>
                                    <button
                                      style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }}
                                      title="Aumentar fonte da coluna direita"
                                      onClick={() => updateBlock(editingBlockIndex, { rightSize: sizeStep(rightSize, 1) })}
                                    >
                                      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_increase</span>
                                    </button>
                                    <span style={{ ...small, fontSize: 11, color: "#475467" }}>ESC/POS {escPosSizeLabel(rightSize)}</span>
                                    <button
                                      style={{
                                        ...btn,
                                        padding: "3px 5px",
                                        fontWeight: 700,
                                        fontSize: 12,
                                        background: rightBold ? "var(--pillActive)" : "white",
                                      }}
                                      onClick={() => updateBlock(editingBlockIndex, { rightBold: !rightBold })}
                                      title="Negrito na coluna direita"
                                    >
                                      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>format_bold</span>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()
                    ) : null}
                  </>
                ) : (
                  <div style={{ ...small }}>
                    Selecione uma linha no ticket para editar as configurações.
                  </div>
                )}
              </div>
              </div>
            </div>
            {testPrintError ? <div style={{ ...small, color: "#b00020" }}>{testPrintError}</div> : null}
            <div style={small}>Clique em um elemento para editar. Arraste para reordenar.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
