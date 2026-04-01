"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  defaultPrintLayout,
  getActiveLayoutIdFromStorage,
  getLayoutsFromStorage,
  resolveActiveLayout,
  saveLayoutsToStorage,
  setActiveLayoutIdInStorage,
  type PrintDataKey,
  type PrintItemTemplateRow,
  type PrintLayout,
  type PrintLayoutBlock,
} from "@/lib/print-layouts";
import {
  ADMIN_STATE_STORAGE_KEY,
  BLANK_LINE_KEY,
  DEFAULT_PREVIEW_CHAR_CELL_PX,
  DEFAULT_SAMPLE_ORDER,
  FREE_TEXT_KEY,
  LINE_EDITOR_WIDTH_PX,
  LINE_WIDTH,
  PREVIEW_CHAR_CELL_OPTIONS,
  PREVIEW_CHAR_CELL_STORAGE_KEY,
  PREVIEW_FONT_PROFILE_STORAGE_KEY,
  PREVIEW_FONT_PROFILES,
  PREVIEW_SCALE_OPTIONS,
  PREVIEW_SIDE_PADDING_PX,
  PREVIEW_VERTICAL_PADDING_PX,
  SIZE_TO_ESC,
  buildEscPosRasterLogo,
  buildSampleOrderFromDrinkNames,
  canonicalizeLayout,
  escPosAlignCommand,
  formatRow2ColForOutput,
  formatTextLineForOutput,
  inferLineKeys,
  isItemDataKey,
  itemRowHasTwoColumns,
  itemTemplateRows,
  lineColumns,
  lineEditorType,
  makeId,
  normalizeSingleLinePreservePadding,
  previewLinesForBlock,
  previewVisibleSpaces,
  rowColumnSettings,
  rowColumnSettingsFromRow,
  type LineEditorType,
  type PreviewFontProfile,
  type SampleOrder,
} from "./impressao-helpers";
import { useImpressaoQzConnection } from "./hooks/useImpressaoQzConnection";
import { BlockEditorPanel } from "./components/BlockEditorPanel";


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
  const [sampleOrder, setSampleOrder] = useState<SampleOrder>(DEFAULT_SAMPLE_ORDER);
  const { testPrintBusy, testPrintError, setTestPrintError, printWithQz } = useImpressaoQzConnection();

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

  const supportsLineDataEditor = (block: PrintLayoutBlock) => block.kind !== "logo" && block.kind !== "separator";
  const lineHasTwoColumns = (block: PrintLayoutBlock) =>
    block.kind === "row_2col" ||
    ((block.kind === "items_template" || block.kind === "items") &&
      (Array.isArray(block.itemRows) && block.itemRows.length ? itemRowHasTwoColumns(block.itemRows[0]) : Boolean(block.leftDataKey || block.rightDataKey)));
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
    try {
      const testTicket = await buildTestTicket();
      await printWithQz(testTicket);
    } catch (error) {
      setTestPrintError(error instanceof Error ? error.message : "Falha ao preparar impressão-teste.");
    }
  }, [buildTestTicket, printWithQz, setTestPrintError]);


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
              <BlockEditorPanel
                editingBlock={editingBlock}
                editingBlockIndex={editingBlockIndex}
                totalBlocks={activeLayout.blocks.length}
                lineEditorWidth={lineEditorWidth}
                btn={btn}
                small={small}
                onSetLineType={setLineType}
                onUpdateBlock={updateBlock}
                onMoveBlock={moveBlock}
                onRemoveBlock={removeBlock}
                onSetLineDataCount={setLineDataCount}
                onSetItemTemplateRowDataCount={setItemTemplateRowDataCount}
                onAddItemTemplateRow={addItemTemplateRow}
                onRemoveItemTemplateRow={removeItemTemplateRow}
                onUpdateItemTemplateRow={updateItemTemplateRow}
              />
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
