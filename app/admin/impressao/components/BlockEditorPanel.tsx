"use client";

import React from "react";
import {
  ALIGN_ICON,
  ALIGN_LABEL,
  ALIGN_OPTIONS,
  BLANK_LINE_KEY,
  DATA_KEY_GROUPS,
  DATA_KEY_LABEL,
  FREE_TEXT_KEY,
  ITEM_DATA_KEY_GROUPS,
  LINE_TYPE_OPTIONS,
  dataKeyPlaceholder,
  escPosSizeLabel,
  inferLineKeys,
  isItemDataKey,
  itemRowHasTwoColumns,
  itemTemplateRows,
  lineEditorType,
  sizeStep,
  type LineEditorType,
} from "../impressao-helpers";
import {
  DEFAULT_LAYOUT_LOGO_PATH,
  blockLabel,
  type PrintDataKey,
  type PrintItemTemplateRow,
  type PrintLayoutBlock,
} from "@/lib/print-layouts";

// Funções auxiliares locais do painel de edição
const hasTextField = (block: PrintLayoutBlock) =>
  block.kind === "custom" || block.kind === "title" || block.kind === "total";

const supportsLineDataEditor = (block: PrintLayoutBlock) =>
  block.kind !== "logo" && block.kind !== "separator";

const lineHasTwoColumns = (block: PrintLayoutBlock) =>
  block.kind === "row_2col" ||
  ((block.kind === "items_template" || block.kind === "items") &&
    (Array.isArray(block.itemRows) && block.itemRows.length
      ? itemRowHasTwoColumns(block.itemRows[0])
      : Boolean(block.leftDataKey || block.rightDataKey)));

const lineDataCount = (block: PrintLayoutBlock) => (lineHasTwoColumns(block) ? 2 : 1);

const getItemRowsForEditing = (block: PrintLayoutBlock) => itemTemplateRows(block);

// Props do painel
interface BlockEditorPanelProps {
  editingBlock: PrintLayoutBlock | null;
  editingBlockIndex: number;
  totalBlocks: number;
  lineEditorWidth: number;
  btn: React.CSSProperties;
  small: React.CSSProperties;
  onSetLineType: (index: number, block: PrintLayoutBlock, type: LineEditorType) => void;
  onUpdateBlock: (index: number, patch: Partial<PrintLayoutBlock>) => void;
  onMoveBlock: (index: number, direction: -1 | 1) => void;
  onRemoveBlock: (index: number) => void;
  onSetLineDataCount: (index: number, block: PrintLayoutBlock, count: number) => void;
  onSetItemTemplateRowDataCount: (index: number, block: PrintLayoutBlock, rowIndex: number, count: number) => void;
  onAddItemTemplateRow: (index: number, block: PrintLayoutBlock) => void;
  onRemoveItemTemplateRow: (index: number, block: PrintLayoutBlock, rowIndex: number) => void;
  onUpdateItemTemplateRow: (index: number, block: PrintLayoutBlock, rowIndex: number, patch: Partial<PrintItemTemplateRow>) => void;
}

export function BlockEditorPanel({
  editingBlock,
  editingBlockIndex,
  totalBlocks,
  lineEditorWidth,
  btn,
  small,
  onSetLineType,
  onUpdateBlock,
  onMoveBlock,
  onRemoveBlock,
  onSetLineDataCount,
  onSetItemTemplateRowDataCount,
  onAddItemTemplateRow,
  onRemoveItemTemplateRow,
  onUpdateItemTemplateRow,
}: BlockEditorPanelProps) {
  return (
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
              onChange={(e) => onSetLineType(editingBlockIndex, editingBlock, e.target.value as LineEditorType)}
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
            <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Mover para cima" onClick={() => onMoveBlock(editingBlockIndex, -1)} disabled={editingBlockIndex === 0}>
              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>arrow_upward</span>
            </button>
            <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Mover para baixo" onClick={() => onMoveBlock(editingBlockIndex, 1)} disabled={editingBlockIndex === totalBlocks - 1}>
              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>arrow_downward</span>
            </button>
            <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Remover linha" onClick={() => onRemoveBlock(editingBlockIndex)} disabled={totalBlocks <= 1}>
              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>delete</span>
            </button>
          </div>
          {hasTextField(editingBlock) ? (
            <input
              value={editingBlock.text ?? ""}
              onChange={(e) => onUpdateBlock(editingBlockIndex, { text: e.target.value })}
              placeholder={editingBlock.kind === "total" ? "TOTAL" : "Texto"}
              style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
            />
          ) : null}
          {editingBlock.kind === "separator" ? (
            <input
              value={editingBlock.separatorChar ?? "-"}
              onChange={(e) => onUpdateBlock(editingBlockIndex, { separatorChar: e.target.value })}
              placeholder="-"
              style={{ ...btn, width: 90, fontWeight: 500, fontSize: 12 }}
            />
          ) : null}
          {editingBlock.kind === "logo" ? (
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ ...small, fontWeight: 700 }}>Logo do preset</div>
              <input
                value={editingBlock.logoPath ?? DEFAULT_LAYOUT_LOGO_PATH}
                onChange={(e) => onUpdateBlock(editingBlockIndex, { logoPath: e.target.value })}
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
                        onClick={() => onAddItemTemplateRow(editingBlockIndex, editingBlock)}
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
                              onClick={() => onSetItemTemplateRowDataCount(editingBlockIndex, editingBlock, rowIndex, rowDataCount - 1)}
                              disabled={rowDataCount <= 1}
                              title="Remover coluna/dado"
                            >
                              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>remove</span>
                            </button>
                            <span style={{ ...small, minWidth: 14, textAlign: "center", fontWeight: 700 }}>{rowDataCount}</span>
                            <button
                              style={{ ...btn, padding: "2px 5px", fontWeight: 700, fontSize: 12, lineHeight: 1 }}
                              onClick={() => onSetItemTemplateRowDataCount(editingBlockIndex, editingBlock, rowIndex, rowDataCount + 1)}
                              disabled={rowDataCount >= 2}
                              title="Adicionar coluna/dado"
                            >
                              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>add</span>
                            </button>
                            <button
                              style={{ ...btn, padding: "2px 5px", fontWeight: 700, fontSize: 12, lineHeight: 1, marginLeft: "auto" }}
                              onClick={() => onRemoveItemTemplateRow(editingBlockIndex, editingBlock, rowIndex)}
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
                                  onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftDataKey: e.target.value as PrintDataKey })}
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
                                    onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftText: e.target.value })}
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
                                    onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftTabCount: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })}
                                    placeholder={`Tab ${dataKeyPlaceholder(rowLeft)}`}
                                    style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                  />
                                  <input
                                    value={row.leftPrefix ?? ""}
                                    onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftPrefix: e.target.value })}
                                    placeholder={`Prefixo ${dataKeyPlaceholder(rowLeft)}`}
                                    style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                  />
                                  <input
                                    value={row.leftSuffix ?? ""}
                                    onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftSuffix: e.target.value })}
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
                                        onClick={() => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftAlign: align })}
                                      >
                                        <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>{ALIGN_ICON[align]}</span>
                                      </button>
                                    ))}
                                  </div>
                                  <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Diminuir fonte da coluna esquerda" onClick={() => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftSize: sizeStep(rowLeftSize, -1) })}>
                                    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_decrease</span>
                                  </button>
                                  <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Aumentar fonte da coluna esquerda" onClick={() => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftSize: sizeStep(rowLeftSize, 1) })}>
                                    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_increase</span>
                                  </button>
                                  <span style={{ ...small, fontSize: 11, color: "#475467" }}>ESC/POS {escPosSizeLabel(rowLeftSize)}</span>
                                  <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12, background: rowLeftBold ? "var(--pillActive)" : "white" }} onClick={() => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { leftBold: !rowLeftBold })} title="Negrito na coluna esquerda">
                                    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>format_bold</span>
                                  </button>
                                </div>
                              </div>
                              <div style={{ display: "grid", gap: 4, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
                                <div style={{ ...small, fontWeight: 700 }}>Coluna direita</div>
                                <select
                                  value={rowRight}
                                  onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightDataKey: e.target.value as PrintDataKey })}
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
                                    onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightText: e.target.value })}
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
                                    onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightTabCount: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })}
                                    placeholder={`Tab ${dataKeyPlaceholder(rowRight)}`}
                                    style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                  />
                                  <input
                                    value={row.rightPrefix ?? ""}
                                    onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightPrefix: e.target.value })}
                                    placeholder={`Prefixo ${dataKeyPlaceholder(rowRight)}`}
                                    style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                  />
                                  <input
                                    value={row.rightSuffix ?? ""}
                                    onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightSuffix: e.target.value })}
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
                                        onClick={() => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightAlign: align })}
                                      >
                                        <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>{ALIGN_ICON[align]}</span>
                                      </button>
                                    ))}
                                  </div>
                                  <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Diminuir fonte da coluna direita" onClick={() => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightSize: sizeStep(rowRightSize, -1) })}>
                                    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_decrease</span>
                                  </button>
                                  <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Aumentar fonte da coluna direita" onClick={() => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightSize: sizeStep(rowRightSize, 1) })}>
                                    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_increase</span>
                                  </button>
                                  <span style={{ ...small, fontSize: 11, color: "#475467" }}>ESC/POS {escPosSizeLabel(rowRightSize)}</span>
                                  <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12, background: rowRightBold ? "var(--pillActive)" : "white" }} onClick={() => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { rightBold: !rowRightBold })} title="Negrito na coluna direita">
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
                                onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { dataKey: e.target.value as PrintDataKey })}
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
                                  onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { text: e.target.value })}
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
                                  onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { tabCount: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })}
                                  placeholder={`Tab ${dataKeyPlaceholder(rowSingle)}`}
                                  style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                />
                                <input
                                  value={row.prefix ?? ""}
                                  onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { prefix: e.target.value })}
                                  placeholder={`Prefixo ${dataKeyPlaceholder(rowSingle)}`}
                                  style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                                />
                                <input
                                  value={row.suffix ?? ""}
                                  onChange={(e) => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { suffix: e.target.value })}
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
                                      onClick={() => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { align })}
                                    >
                                      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>{ALIGN_ICON[align]}</span>
                                    </button>
                                  ))}
                                </div>
                                <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Diminuir fonte" onClick={() => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { size: sizeStep(row.size ?? "normal", -1) })}>
                                  <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_decrease</span>
                                </button>
                                <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }} title="Aumentar fonte" onClick={() => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { size: sizeStep(row.size ?? "normal", 1) })}>
                                  <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_increase</span>
                                </button>
                                <span style={{ ...small, fontSize: 11, color: "#475467" }}>ESC/POS {escPosSizeLabel(row.size ?? "normal")}</span>
                                <button style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12, background: (row.bold ?? false) ? "var(--pillActive)" : "white" }} onClick={() => onUpdateItemTemplateRow(editingBlockIndex, editingBlock, rowIndex, { bold: !(row.bold ?? false) })} title="Negrito">
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
                      onClick={() => onSetLineDataCount(editingBlockIndex, editingBlock, dataCount - 1)}
                      disabled={dataCount <= 1}
                      title="Remover dado da linha"
                    >
                      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>remove</span>
                    </button>
                    <span style={{ ...small, minWidth: 14, textAlign: "center", fontWeight: 700 }}>{dataCount}</span>
                    <button
                      style={{ ...btn, padding: "2px 5px", fontWeight: 700, fontSize: 12, lineHeight: 1 }}
                      onClick={() => onSetLineDataCount(editingBlockIndex, editingBlock, dataCount + 1)}
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
                          onUpdateBlock(editingBlockIndex, {
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
                          onChange={(e) => onUpdateBlock(editingBlockIndex, { text: e.target.value })}
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
                          onChange={(e) => onUpdateBlock(editingBlockIndex, { tabCount: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })}
                          placeholder={`Tab ${dataKeyPlaceholder(inferred.single)}`}
                          style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                        />
                        <input
                          value={editingBlock.prefix ?? ""}
                          onChange={(e) => onUpdateBlock(editingBlockIndex, { prefix: e.target.value })}
                          placeholder={`Prefixo ${dataKeyPlaceholder(inferred.single)}`}
                          style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                        />
                        <input
                          value={editingBlock.suffix ?? ""}
                          onChange={(e) => onUpdateBlock(editingBlockIndex, { suffix: e.target.value })}
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
                                onClick={() => onUpdateBlock(editingBlockIndex, { align })}
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
                          onClick={() => onUpdateBlock(editingBlockIndex, { size: sizeStep(editingBlock.size ?? "normal", -1) })}
                        >
                          <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_decrease</span>
                        </button>
                        <button
                          style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }}
                          title="Aumentar fonte"
                          onClick={() => onUpdateBlock(editingBlockIndex, { size: sizeStep(editingBlock.size ?? "normal", 1) })}
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
                          onClick={() => onUpdateBlock(editingBlockIndex, { bold: !(editingBlock.bold ?? false) })}
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
                            onUpdateBlock(editingBlockIndex, {
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
                            onChange={(e) => onUpdateBlock(editingBlockIndex, { leftText: e.target.value })}
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
                            onChange={(e) => onUpdateBlock(editingBlockIndex, { leftTabCount: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })}
                            placeholder={`Tab ${dataKeyPlaceholder(inferred.left)}`}
                            style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                          />
                          <input
                            value={editingBlock.leftPrefix ?? ""}
                            onChange={(e) => onUpdateBlock(editingBlockIndex, { leftPrefix: e.target.value })}
                            placeholder={`Prefixo ${dataKeyPlaceholder(inferred.left)}`}
                            style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                          />
                          <input
                            value={editingBlock.leftSuffix ?? ""}
                            onChange={(e) => onUpdateBlock(editingBlockIndex, { leftSuffix: e.target.value })}
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
                                  onClick={() => onUpdateBlock(editingBlockIndex, { leftAlign: align })}
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
                            onClick={() => onUpdateBlock(editingBlockIndex, { leftSize: sizeStep(leftSize, -1) })}
                          >
                            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_decrease</span>
                          </button>
                          <button
                            style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }}
                            title="Aumentar fonte da coluna esquerda"
                            onClick={() => onUpdateBlock(editingBlockIndex, { leftSize: sizeStep(leftSize, 1) })}
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
                            onClick={() => onUpdateBlock(editingBlockIndex, { leftBold: !leftBold })}
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
                            onUpdateBlock(editingBlockIndex, {
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
                            onChange={(e) => onUpdateBlock(editingBlockIndex, { rightText: e.target.value })}
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
                            onChange={(e) => onUpdateBlock(editingBlockIndex, { rightTabCount: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })}
                            placeholder={`Tab ${dataKeyPlaceholder(inferred.right)}`}
                            style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                          />
                          <input
                            value={editingBlock.rightPrefix ?? ""}
                            onChange={(e) => onUpdateBlock(editingBlockIndex, { rightPrefix: e.target.value })}
                            placeholder={`Prefixo ${dataKeyPlaceholder(inferred.right)}`}
                            style={{ ...btn, fontWeight: 500, fontSize: 12, minWidth: 0, width: "100%", boxSizing: "border-box" }}
                          />
                          <input
                            value={editingBlock.rightSuffix ?? ""}
                            onChange={(e) => onUpdateBlock(editingBlockIndex, { rightSuffix: e.target.value })}
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
                                  onClick={() => onUpdateBlock(editingBlockIndex, { rightAlign: align })}
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
                            onClick={() => onUpdateBlock(editingBlockIndex, { rightSize: sizeStep(rightSize, -1) })}
                          >
                            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>text_decrease</span>
                          </button>
                          <button
                            style={{ ...btn, padding: "3px 5px", fontWeight: 700, fontSize: 12 }}
                            title="Aumentar fonte da coluna direita"
                            onClick={() => onUpdateBlock(editingBlockIndex, { rightSize: sizeStep(rightSize, 1) })}
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
                            onClick={() => onUpdateBlock(editingBlockIndex, { rightBold: !rightBold })}
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
  );
}
