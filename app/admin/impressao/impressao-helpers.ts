import type { PrintAlign, PrintDataKey, PrintItemTemplateRow, PrintLayout, PrintLayoutBlock } from "@/lib/print-layouts";
import { DEFAULT_LAYOUT_LOGO_PATH } from "@/lib/print-layouts";
import type { QzTextSizePreset } from "@/lib/qz-tray";

export const SIZE_OPTIONS: QzTextSizePreset[] = ["normal", "2x", "3x"];
export const ALIGN_OPTIONS: PrintAlign[] = ["left", "center", "right", "justify"];
export const FREE_TEXT_KEY: PrintDataKey = "free_text";
export const BLANK_LINE_KEY: PrintDataKey = "blank_line";
export const ALIGN_ICON: Record<PrintAlign, string> = {
  left: "format_align_left",
  center: "format_align_center",
  right: "format_align_right",
  justify: "format_align_justify",
};
export const ALIGN_LABEL: Record<PrintAlign, string> = {
  left: "Alinhar à esquerda",
  center: "Alinhar ao centro",
  right: "Alinhar à direita",
  justify: "Justificar",
};
export const LINE_WIDTH = 32;
export const PREVIEW_CHAR_CELL_OPTIONS = [7.5, 8, 8.5] as const;
export const DEFAULT_PREVIEW_CHAR_CELL_PX = 8;
export const PREVIEW_CHAR_CELL_STORAGE_KEY = "orders_preview_char_cell_px";
export type PreviewFontProfile = "modern" | "thermal";
export const PREVIEW_FONT_PROFILE_STORAGE_KEY = "orders_preview_font_profile";
export const PREVIEW_FONT_PROFILES: Array<{ id: PreviewFontProfile; label: string }> = [
  { id: "thermal", label: "Térmica" },
  { id: "modern", label: "Moderna" },
];
export const PREVIEW_SIDE_PADDING_PX = 10;
export const PREVIEW_VERTICAL_PADDING_PX = 10;
export const PREVIEW_SCALE_OPTIONS = [1, 1.25, 1.5] as const;
export const ADMIN_STATE_STORAGE_KEY = "mixologia_drink_cost_v4_menu_rounding";
export const LINE_EDITOR_WIDTH_PX = 320;
export const SIZE_TO_ESC: Record<QzTextSizePreset, string> = {
  normal: "\x1D\x21\x00",
  "2x": "\x1D\x21\x11",
  "3x": "\x1D\x21\x22",
};

export function buildEscPosBitImage24(raster: Uint8Array, widthDots: number, heightDots: number) {
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

export async function buildEscPosRasterLogo(imagePath: string, maxWidthDots = 384, maxHeightDots = 160) {
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

export type ComposeElementKind = "customer" | "items" | "items_count" | "total";
export type LineEditorType = "text" | "separator" | "logo" | "items";

export const COMPOSE_DEFAULTS: Record<ComposeElementKind, { left: string[]; right: string[] }> = {
  customer: { left: ["customer_name"], right: ["customer_phone"] },
  items: { left: ["item_qty_price"], right: ["item_total"] },
  items_count: { left: ["items_label"], right: ["items_count"] },
  total: { left: ["total_label"], right: ["total_value"] },
};

export const DATA_KEY_GROUPS: Array<{ label: string; keys: PrintDataKey[] }> = [
  { label: "Pedido", keys: ["code", "datetime", "source", "order_notes"] },
  { label: "Cliente", keys: ["customer_name", "customer_phone"] },
  { label: "Item", keys: ["item_name", "item_qty", "item_unit_price", "item_qty_price", "item_total", "item_notes"] },
  { label: "Resumo", keys: ["items_label", "items_count", "total_label", "total_value"] },
  { label: "Custom", keys: [FREE_TEXT_KEY, BLANK_LINE_KEY] },
];
export const ITEM_DATA_KEY_GROUPS: Array<{ label: string; keys: PrintDataKey[] }> = [
  { label: "Item", keys: ["item_name", "item_qty", "item_unit_price", "item_qty_price", "item_total", "item_notes"] },
  { label: "Custom", keys: [FREE_TEXT_KEY, BLANK_LINE_KEY] },
];

export const DATA_KEY_LABEL: Record<PrintDataKey, string> = {
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

export const LINE_TYPE_OPTIONS: Array<{ value: LineEditorType; label: string }> = [
  { value: "text", label: "Texto" },
  { value: "items", label: "Itens" },
  { value: "separator", label: "Separador" },
  { value: "logo", label: "Logo" },
];

export function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function wrapText(text: string, width: number) {
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

export function leftRightLineInfo(left: string, right: string, width: number) {
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

export function compactSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export type SampleOrder = {
  code: string;
  createdAt: string;
  source: string;
  customerName: string;
  customerPhone: string;
  notes: string;
  subtotal: string;
  items: Array<{ name: string; qtyPrice: string; total: string; notes?: string }>;
};

export const DEFAULT_SAMPLE_ORDER: SampleOrder = {
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

export function buildSampleOrderFromDrinkNames(names: string[]) {
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

export function columnsForSize(size: QzTextSizePreset) {
  if (size === "3x") return 8;
  if (size === "2x") return 13;
  return LINE_WIDTH;
}

export function fitPresetToContent(baseWidth: number, preferred: QzTextSizePreset, minColumns: number): QzTextSizePreset {
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

export type PreviewLine =
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

export function lineColumns(text: string) {
  return Array.from(text).length;
}

export function truncateToColumns(text: string, maxColumns: number) {
  const chars = Array.from(text);
  if (chars.length <= maxColumns) return text;
  if (maxColumns <= 3) return chars.slice(0, maxColumns).join("");
  return `${chars.slice(0, maxColumns - 3).join("")}...`;
}

export function normalizeSingleLinePreservePadding(text: string) {
  return text.replace(/\r?\n/g, " ");
}

export function decorateDataValue(base: string, options?: { tabCount?: number; prefix?: string; suffix?: string }) {
  const tabs = Math.max(0, Math.min(12, options?.tabCount ?? 0));
  const pad = " ".repeat(tabs * 4);
  const prefix = options?.prefix ?? "";
  const suffix = options?.suffix ?? "";
  return `${pad}${prefix}${base}${suffix}`;
}

export function resolveDecoratedDataValue(
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

export function dataKeyPlaceholder(key: PrintDataKey) {
  if (key === FREE_TEXT_KEY) return "Texto livre";
  if (key === BLANK_LINE_KEY) return "Linha vazia";
  return DATA_KEY_LABEL[key];
}

export function previewVisibleSpaces(text: string) {
  return text;
}

export function fitTextToColumns(text: string, maxColumns: number, align: PrintAlign) {
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

export function resolveTwoColumnLayout(totalColumns: number, leftUsedColumns: number, rightUsedColumns: number) {
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

export function rowColumnSettings(block: PrintLayoutBlock) {
  return {
    leftAlign: block.leftAlign ?? block.align ?? "left",
    rightAlign: block.rightAlign ?? (block.align === "center" ? "center" : "right"),
    leftSize: block.leftSize ?? block.size ?? "normal",
    rightSize: block.rightSize ?? block.size ?? "normal",
    leftBold: block.leftBold ?? block.bold ?? false,
    rightBold: block.rightBold ?? block.bold ?? false,
  } as const;
}

export function rowColumnSettingsFromRow(row: PrintItemTemplateRow) {
  return {
    leftAlign: row.leftAlign ?? row.align ?? "left",
    rightAlign: row.rightAlign ?? (row.align === "center" ? "center" : "right"),
    leftSize: row.leftSize ?? row.size ?? "normal",
    rightSize: row.rightSize ?? row.size ?? "normal",
    leftBold: row.leftBold ?? row.bold ?? false,
    rightBold: row.rightBold ?? row.bold ?? false,
  } as const;
}

export function isNotesDataKey(key?: PrintDataKey) {
  return key === "item_notes" || key === "order_notes";
}

export function lineEditorType(block: PrintLayoutBlock): LineEditorType {
  if (block.kind === "logo") return "logo";
  if (block.kind === "separator") return "separator";
  if (block.kind === "items_template" || block.kind === "items") return "items";
  return "text";
}

export function itemTemplateRows(block: PrintLayoutBlock): PrintItemTemplateRow[] {
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

export function itemRowHasTwoColumns(row: PrintItemTemplateRow) {
  return Boolean(row.leftDataKey || row.rightDataKey);
}

export function canonicalizeBlock(block: PrintLayoutBlock): PrintLayoutBlock {
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

export function canonicalizeLayout(layout: PrintLayout): PrintLayout {
  return {
    ...layout,
    blocks: layout.blocks.map((block) => canonicalizeBlock(block)),
  };
}

export function glyphColumnWidth(char: string) {
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

export function separatorLine(charInput: string | undefined, width: number) {
  const char = Array.from(charInput?.trim() || "")[0] || "-";
  const charWidth = Math.max(1, glyphColumnWidth(char));
  const repeatCount = Math.max(1, Math.floor(width / charWidth));
  return char.repeat(repeatCount);
}

export function previewLinesForBlock(block: PrintLayoutBlock, sampleOrder: SampleOrder) {
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

export function sizeStep(value: QzTextSizePreset, direction: -1 | 1): QzTextSizePreset {
  const idx = SIZE_OPTIONS.indexOf(value);
  if (idx < 0) return value;
  const next = Math.max(0, Math.min(SIZE_OPTIONS.length - 1, idx + direction));
  return SIZE_OPTIONS[next];
}

export function escPosSizeLabel(value: QzTextSizePreset) {
  if (value === "normal") return "Normal";
  return value.toUpperCase();
}

export function effectiveComposeParts(block: PrintLayoutBlock, kind: ComposeElementKind) {
  const defaults = COMPOSE_DEFAULTS[kind];
  const left = Array.isArray(block.composeLeft) && block.composeLeft.length ? block.composeLeft : defaults.left;
  const right = Array.isArray(block.composeRight) && block.composeRight.length ? block.composeRight : defaults.right;
  return { left, right };
}

export function composeFromParts(parts: string[], values: Record<string, string>) {
  return compactSpaces(parts.map((part) => values[part] ?? "").filter(Boolean).join(" "));
}

export function isItemDataKey(key?: PrintDataKey) {
  return Boolean(key && key.startsWith("item_"));
}

export function inferLineKeys(block: PrintLayoutBlock) {
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

export function sampleOrderValue(key: PrintDataKey, block: PrintLayoutBlock, sampleOrder: SampleOrder) {
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

export function sampleItemValue(key: PrintDataKey, item: SampleOrder["items"][number]) {
  if (key === "item_name") return item.name;
  if (key === "item_qty") return compactSpaces(item.qtyPrice.split("x")[0] ?? "");
  if (key === "item_unit_price") return compactSpaces(item.qtyPrice.split("x")[1] ?? "");
  if (key === "item_qty_price") return item.qtyPrice;
  if (key === "item_total") return item.total;
  if (key === "item_notes") return item.notes ?? "";
  return "";
}

export function toLatin1Safe(value: string) {
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

export function escPosAlignCommand(align: PrintAlign) {
  if (align === "justify") return "\x1B\x61\x00";
  if (align === "center") return "\x1B\x61\x01";
  if (align === "right") return "\x1B\x61\x02";
  return "\x1B\x61\x00";
}

export function formatRow2ColForOutput(line: Extract<PreviewLine, { type: "row_2col" }>) {
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

export function formatTextLineForOutput(line: Extract<PreviewLine, { type: "text" }>, fallbackAlign: PrintAlign, fallbackSize: QzTextSizePreset) {
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
