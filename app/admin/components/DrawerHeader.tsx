import React, { useState } from "react";

type Props = {
  breadcrumb: string;
  activeLabel: string;
  name: string;
  onNameChange: (value: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  subheadItems?: string[];
  size?: "sm" | "lg";
};

export function DrawerHeader({
  breadcrumb,
  activeLabel,
  name,
  onNameChange,
  onDuplicate,
  onDelete,
  subheadItems,
  size = "sm",
}: Props) {
  const [deleteHover, setDeleteHover] = useState(false);

  const isLg = size === "lg";
  const crumbSize = isLg ? 12 : 11;
  const headGap = isLg ? 10 : 8;
  const headMarginBottom = isLg ? 6 : 4;
  const nameSize = isLg ? 24 : 22;
  const btnSize = isLg ? 34 : 30;
  const btnRadius = isLg ? 8 : 7;
  const subheadFontSize = isLg ? 12 : 11;
  const subheadPaddingBottom = isLg ? 16 : 12;
  const subheadGap = isLg ? 14 : 10;
  const subheadMarginBottom = isLg ? 20 : 16;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Breadcrumb */}
      <p style={{ fontSize: crumbSize, color: "var(--muted)", margin: "0 0 6px", letterSpacing: "0.02em" }}>
        {breadcrumb} /{" "}
        <strong style={{ color: "var(--foreground)", fontWeight: 500 }}>{activeLabel}</strong>
      </p>

      {/* Nome + ações */}
      <div style={{ display: "flex", alignItems: "center", gap: headGap, marginBottom: headMarginBottom }}>
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Nome..."
          style={{
            flex: 1,
            fontSize: nameSize,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            border: "none",
            borderBottom: "2px solid transparent",
            borderRadius: 0,
            background: "transparent",
            outline: "none",
            padding: "2px 0",
            color: "var(--foreground)",
            transition: "border-color 160ms ease",
            fontFamily: "inherit",
          }}
          onFocus={(e) => (e.currentTarget.style.borderBottomColor = "var(--accent)")}
          onBlur={(e) => (e.currentTarget.style.borderBottomColor = "transparent")}
        />
        <button
          onClick={onDuplicate}
          title="Duplicar"
          style={{
            width: btnSize,
            height: btnSize,
            borderRadius: btnRadius,
            border: "1px solid var(--line)",
            backgroundColor: "transparent",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
            color: "var(--muted)",
          }}
        >
          <span
            className="material-symbols-rounded"
            style={{ fontSize: 16, fontVariationSettings: '"FILL" 0, "wght" 500, "GRAD" 0, "opsz" 16' }}
          >
            content_copy
          </span>
        </button>
        <button
          onClick={onDelete}
          title="Deletar"
          onMouseEnter={() => setDeleteHover(true)}
          onMouseLeave={() => setDeleteHover(false)}
          style={{
            width: btnSize,
            height: btnSize,
            borderRadius: btnRadius,
            border: `1px solid ${deleteHover ? "var(--danger-border)" : "var(--line)"}`,
            backgroundColor: deleteHover ? "var(--danger-bg)" : "transparent",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
            transition: "background-color 120ms ease, border-color 120ms ease",
          }}
        >
          <span
            className="material-symbols-rounded"
            style={{
              fontSize: 16,
              color: deleteHover ? "var(--danger)" : "var(--muted)",
              fontVariationSettings: '"FILL" 0, "wght" 500, "GRAD" 0, "opsz" 16',
              transition: "color 120ms ease",
            }}
          >
            delete
          </span>
        </button>
      </div>

      {/* Subhead */}
      {subheadItems && subheadItems.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: subheadGap,
            alignItems: "center",
            flexWrap: "wrap",
            fontSize: subheadFontSize,
            color: "var(--muted)",
            marginTop: 2,
            paddingBottom: subheadPaddingBottom,
            borderBottom: "1px solid var(--line)",
            marginBottom: subheadMarginBottom,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: "var(--accent)",
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            {subheadItems[0]}
          </span>
          {subheadItems.slice(1).map((item, i) => (
            <React.Fragment key={i}>
              <span>·</span>
              <span>{item}</span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
