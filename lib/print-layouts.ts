import type { QzTextSizePreset } from "@/lib/qz-tray";

export const QZ_LAYOUTS_STORAGE_KEY = "orders_qz_layouts";
export const QZ_ACTIVE_LAYOUT_STORAGE_KEY = "orders_qz_active_layout_id";
export const DEFAULT_PRINT_LAYOUT_ID = "default";
export const DEFAULT_LAYOUT_LOGO_PATH = "/manteca-logo.svg";

export type PrintAlign = "left" | "center" | "right" | "justify";
export type PrintBlockKind =
  | "logo"
  | "title"
  | "code"
  | "separator"
  | "datetime"
  | "source"
  | "data"
  | "row_2col"
  | "items_template"
  | "customer"
  | "items"
  | "items_count"
  | "notes"
  | "total"
  | "custom"
  | "blank";

export type PrintDataKey =
  | "customer_name"
  | "customer_phone"
  | "item_name"
  | "item_qty"
  | "item_unit_price"
  | "item_qty_price"
  | "item_total"
  | "item_notes"
  | "items_label"
  | "items_count"
  | "total_label"
  | "total_value"
  | "order_notes"
  | "source"
  | "datetime"
  | "code"
  | "free_text"
  | "blank_line";

export type PrintItemTemplateRow = {
  id: string;
  dataKey?: PrintDataKey;
  leftDataKey?: PrintDataKey;
  rightDataKey?: PrintDataKey;
  columnSeparator?: string;
  text?: string;
  leftText?: string;
  rightText?: string;
  tabCount?: number;
  leftTabCount?: number;
  rightTabCount?: number;
  prefix?: string;
  suffix?: string;
  leftPrefix?: string;
  leftSuffix?: string;
  rightPrefix?: string;
  rightSuffix?: string;
  align?: PrintAlign;
  size?: QzTextSizePreset;
  bold?: boolean;
  leftAlign?: PrintAlign;
  rightAlign?: PrintAlign;
  leftSize?: QzTextSizePreset;
  rightSize?: QzTextSizePreset;
  leftBold?: boolean;
  rightBold?: boolean;
};

export type PrintLayoutBlock = {
  id: string;
  kind: PrintBlockKind;
  logoPath?: string;
  align?: PrintAlign;
  size?: QzTextSizePreset;
  bold?: boolean;
  leftAlign?: PrintAlign;
  rightAlign?: PrintAlign;
  leftSize?: QzTextSizePreset;
  rightSize?: QzTextSizePreset;
  leftBold?: boolean;
  rightBold?: boolean;
  text?: string;
  separatorChar?: string;
  tabCount?: number;
  leftTabCount?: number;
  rightTabCount?: number;
  prefix?: string;
  suffix?: string;
  leftPrefix?: string;
  leftSuffix?: string;
  rightPrefix?: string;
  rightSuffix?: string;
  composeLeft?: string[];
  composeRight?: string[];
  dataKey?: PrintDataKey;
  leftDataKey?: PrintDataKey;
  rightDataKey?: PrintDataKey;
  columnSeparator?: string;
  leftText?: string;
  rightText?: string;
  itemRows?: PrintItemTemplateRow[];
};

export type PrintLayout = {
  id: string;
  name: string;
  blocks: PrintLayoutBlock[];
};

export function blockLabel(kind: PrintBlockKind) {
  const labels: Record<PrintBlockKind, string> = {
    logo: "Logo",
    title: "Titulo",
    code: "Codigo do pedido",
    separator: "Linha separadora",
    datetime: "Data/hora",
    source: "Origem",
    data: "Linha",
    row_2col: "Linha 2 colunas",
    items_template: "Template de itens",
    customer: "Cliente",
    items: "Itens",
    items_count: "Contador de itens",
    notes: "Observacoes do pedido",
    total: "Total",
    custom: "Texto livre",
    blank: "Espaco em branco",
  };
  return labels[kind];
}

const VALID_KINDS = new Set<PrintBlockKind>([
  "logo",
  "title",
  "code",
  "separator",
  "datetime",
  "source",
  "data",
  "row_2col",
  "items_template",
  "customer",
  "items",
  "items_count",
  "notes",
  "total",
  "custom",
  "blank",
]);

const VALID_ALIGNS = new Set<PrintAlign>(["left", "center", "right", "justify"]);
const VALID_SIZES = new Set<QzTextSizePreset>(["normal", "2x", "3x"]);

function defaultBlocks(): PrintLayoutBlock[] {
  return [
    { id: "b_logo", kind: "logo", logoPath: DEFAULT_LAYOUT_LOGO_PATH },
    { id: "b_title", kind: "title", align: "center", size: "2x", bold: true, text: "PEDIDO" },
    { id: "b_code", kind: "code", align: "center", bold: true },
    { id: "b_sep_1", kind: "separator", separatorChar: "=" },
    { id: "b_datetime", kind: "datetime" },
    { id: "b_source", kind: "source" },
    { id: "b_customer", kind: "row_2col", leftDataKey: "customer_name", rightDataKey: "customer_phone" },
    { id: "b_sep_2", kind: "separator", separatorChar: "-" },
    { id: "b_item_name", kind: "data", dataKey: "item_name" },
    { id: "b_items", kind: "row_2col", leftDataKey: "item_qty_price", rightDataKey: "item_total" },
    { id: "b_sep_3", kind: "separator", separatorChar: "-" },
    { id: "b_items_count", kind: "row_2col", leftDataKey: "items_label", rightDataKey: "items_count" },
    { id: "b_notes", kind: "notes" },
    { id: "b_sep_4", kind: "separator", separatorChar: "=" },
    { id: "b_total", kind: "row_2col", leftDataKey: "total_label", rightDataKey: "total_value", size: "2x", bold: true, text: "TOTAL" },
  ];
}

export function defaultPrintLayout(): PrintLayout {
  return {
    id: DEFAULT_PRINT_LAYOUT_ID,
    name: "Padrao",
    blocks: defaultBlocks(),
  };
}

function normalizeBlock(raw: unknown, index: number): PrintLayoutBlock {
  const fallback = defaultBlocks()[Math.min(index, defaultBlocks().length - 1)] ?? {
    id: `block_${index}`,
    kind: "custom" as const,
  };
  if (!raw || typeof raw !== "object") return { ...fallback };
  const value = raw as Partial<PrintLayoutBlock>;
  const kind = VALID_KINDS.has(value.kind as PrintBlockKind) ? (value.kind as PrintBlockKind) : fallback.kind;
  const logoPath = typeof value.logoPath === "string" ? value.logoPath : undefined;
  const align = VALID_ALIGNS.has(value.align as PrintAlign) ? (value.align as PrintAlign) : undefined;
  const size = VALID_SIZES.has(value.size as QzTextSizePreset) ? (value.size as QzTextSizePreset) : undefined;
  const itemRows = Array.isArray(value.itemRows)
    ? value.itemRows
        .map((row, rowIndex) => {
          if (!row || typeof row !== "object") return null;
          const v = row as Partial<PrintItemTemplateRow>;
          return {
            id: typeof v.id === "string" && v.id.trim() ? v.id : `item_row_${index}_${rowIndex}`,
            dataKey: typeof v.dataKey === "string" ? (v.dataKey as PrintDataKey) : undefined,
            leftDataKey: typeof v.leftDataKey === "string" ? (v.leftDataKey as PrintDataKey) : undefined,
            rightDataKey: typeof v.rightDataKey === "string" ? (v.rightDataKey as PrintDataKey) : undefined,
            columnSeparator: typeof v.columnSeparator === "string" ? v.columnSeparator : undefined,
            text: typeof v.text === "string" ? v.text : undefined,
            leftText: typeof v.leftText === "string" ? v.leftText : undefined,
            rightText: typeof v.rightText === "string" ? v.rightText : undefined,
            tabCount: Number.isFinite(v.tabCount) ? Math.max(0, Math.min(12, Number(v.tabCount))) : undefined,
            leftTabCount: Number.isFinite(v.leftTabCount) ? Math.max(0, Math.min(12, Number(v.leftTabCount))) : undefined,
            rightTabCount: Number.isFinite(v.rightTabCount) ? Math.max(0, Math.min(12, Number(v.rightTabCount))) : undefined,
            prefix: typeof v.prefix === "string" ? v.prefix : undefined,
            suffix: typeof v.suffix === "string" ? v.suffix : undefined,
            leftPrefix: typeof v.leftPrefix === "string" ? v.leftPrefix : undefined,
            leftSuffix: typeof v.leftSuffix === "string" ? v.leftSuffix : undefined,
            rightPrefix: typeof v.rightPrefix === "string" ? v.rightPrefix : undefined,
            rightSuffix: typeof v.rightSuffix === "string" ? v.rightSuffix : undefined,
            align: VALID_ALIGNS.has(v.align as PrintAlign) ? (v.align as PrintAlign) : undefined,
            size: VALID_SIZES.has(v.size as QzTextSizePreset) ? (v.size as QzTextSizePreset) : undefined,
            bold: typeof v.bold === "boolean" ? v.bold : undefined,
            leftAlign: VALID_ALIGNS.has(v.leftAlign as PrintAlign) ? (v.leftAlign as PrintAlign) : undefined,
            rightAlign: VALID_ALIGNS.has(v.rightAlign as PrintAlign) ? (v.rightAlign as PrintAlign) : undefined,
            leftSize: VALID_SIZES.has(v.leftSize as QzTextSizePreset) ? (v.leftSize as QzTextSizePreset) : undefined,
            rightSize: VALID_SIZES.has(v.rightSize as QzTextSizePreset) ? (v.rightSize as QzTextSizePreset) : undefined,
            leftBold: typeof v.leftBold === "boolean" ? v.leftBold : undefined,
            rightBold: typeof v.rightBold === "boolean" ? v.rightBold : undefined,
          } satisfies PrintItemTemplateRow;
        })
        .filter((row): row is PrintItemTemplateRow => Boolean(row))
    : undefined;
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : `block_${index}`,
    kind,
    logoPath: kind === "logo" ? (logoPath ?? DEFAULT_LAYOUT_LOGO_PATH) : undefined,
    align,
    size,
    bold: typeof value.bold === "boolean" ? value.bold : undefined,
    leftAlign: VALID_ALIGNS.has(value.leftAlign as PrintAlign) ? (value.leftAlign as PrintAlign) : undefined,
    rightAlign: VALID_ALIGNS.has(value.rightAlign as PrintAlign) ? (value.rightAlign as PrintAlign) : undefined,
    leftSize: VALID_SIZES.has(value.leftSize as QzTextSizePreset) ? (value.leftSize as QzTextSizePreset) : undefined,
    rightSize: VALID_SIZES.has(value.rightSize as QzTextSizePreset) ? (value.rightSize as QzTextSizePreset) : undefined,
    leftBold: typeof value.leftBold === "boolean" ? value.leftBold : undefined,
    rightBold: typeof value.rightBold === "boolean" ? value.rightBold : undefined,
    text: typeof value.text === "string" ? value.text : undefined,
    separatorChar: typeof value.separatorChar === "string" ? value.separatorChar : undefined,
    tabCount: Number.isFinite(value.tabCount) ? Math.max(0, Math.min(12, Number(value.tabCount))) : undefined,
    leftTabCount: Number.isFinite(value.leftTabCount) ? Math.max(0, Math.min(12, Number(value.leftTabCount))) : undefined,
    rightTabCount: Number.isFinite(value.rightTabCount) ? Math.max(0, Math.min(12, Number(value.rightTabCount))) : undefined,
    prefix: typeof value.prefix === "string" ? value.prefix : undefined,
    suffix: typeof value.suffix === "string" ? value.suffix : undefined,
    leftPrefix: typeof value.leftPrefix === "string" ? value.leftPrefix : undefined,
    leftSuffix: typeof value.leftSuffix === "string" ? value.leftSuffix : undefined,
    rightPrefix: typeof value.rightPrefix === "string" ? value.rightPrefix : undefined,
    rightSuffix: typeof value.rightSuffix === "string" ? value.rightSuffix : undefined,
    composeLeft: Array.isArray(value.composeLeft) ? value.composeLeft.filter((part): part is string => typeof part === "string") : undefined,
    composeRight: Array.isArray(value.composeRight) ? value.composeRight.filter((part): part is string => typeof part === "string") : undefined,
    dataKey: typeof value.dataKey === "string" ? (value.dataKey as PrintDataKey) : undefined,
    leftDataKey: typeof value.leftDataKey === "string" ? (value.leftDataKey as PrintDataKey) : undefined,
    rightDataKey: typeof value.rightDataKey === "string" ? (value.rightDataKey as PrintDataKey) : undefined,
    columnSeparator: typeof value.columnSeparator === "string" ? value.columnSeparator : undefined,
    leftText: typeof value.leftText === "string" ? value.leftText : undefined,
    rightText: typeof value.rightText === "string" ? value.rightText : undefined,
    itemRows: itemRows?.length ? itemRows : undefined,
  };
}

function normalizeLayout(raw: unknown, index: number): PrintLayout {
  const fallback = defaultPrintLayout();
  if (!raw || typeof raw !== "object") {
    return index === 0 ? fallback : { ...fallback, id: `layout_${index}`, name: `Layout ${index + 1}` };
  }
  const value = raw as Partial<PrintLayout>;
  const blocksRaw = Array.isArray(value.blocks) ? value.blocks : [];
  const blocks = blocksRaw.map((block, i) => normalizeBlock(block, i)).filter((block) => block.id.trim());
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : index === 0 ? fallback.id : `layout_${index}`,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : index === 0 ? fallback.name : `Layout ${index + 1}`,
    blocks: blocks.length ? blocks : defaultBlocks(),
  };
}

function uniqueLayouts(layouts: PrintLayout[]) {
  const seen = new Set<string>();
  const dedup: PrintLayout[] = [];
  for (const layout of layouts) {
    if (seen.has(layout.id)) continue;
    seen.add(layout.id);
    dedup.push(layout);
  }
  return dedup;
}

export function normalizeLayouts(raw: unknown): PrintLayout[] {
  const parsed = Array.isArray(raw) ? raw.map((item, i) => normalizeLayout(item, i)) : [];
  const dedup = uniqueLayouts(parsed);
  if (!dedup.length) return [defaultPrintLayout()];
  if (!dedup.some((layout) => layout.id === DEFAULT_PRINT_LAYOUT_ID)) {
    return [defaultPrintLayout(), ...dedup];
  }
  return dedup;
}

export function getLayoutsFromStorage(storage: Storage = localStorage): PrintLayout[] {
  try {
    const raw = storage.getItem(QZ_LAYOUTS_STORAGE_KEY);
    if (!raw) return [defaultPrintLayout()];
    return normalizeLayouts(JSON.parse(raw));
  } catch {
    return [defaultPrintLayout()];
  }
}

export function saveLayoutsToStorage(layouts: PrintLayout[], storage: Storage = localStorage) {
  const normalized = normalizeLayouts(layouts);
  storage.setItem(QZ_LAYOUTS_STORAGE_KEY, JSON.stringify(normalized));
}

export function getActiveLayoutIdFromStorage(storage: Storage = localStorage) {
  try {
    const id = storage.getItem(QZ_ACTIVE_LAYOUT_STORAGE_KEY);
    return typeof id === "string" && id.trim() ? id.trim() : DEFAULT_PRINT_LAYOUT_ID;
  } catch {
    return DEFAULT_PRINT_LAYOUT_ID;
  }
}

export function setActiveLayoutIdInStorage(layoutId: string, storage: Storage = localStorage) {
  storage.setItem(QZ_ACTIVE_LAYOUT_STORAGE_KEY, layoutId);
}

export function resolveActiveLayout(layouts: PrintLayout[], activeId: string): PrintLayout {
  return layouts.find((layout) => layout.id === activeId) ?? layouts[0] ?? defaultPrintLayout();
}

export function buildLayoutOptions(layouts: PrintLayout[]) {
  return layouts.map((layout) => ({ id: layout.id, name: layout.name }));
}
