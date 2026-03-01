import type React from "react";

type ThemeVars = React.CSSProperties & Record<`--${string}`, string>;

export const internalThemeVars: ThemeVars = {
  ["--bg"]: "#f6f2ea",
  ["--panel"]: "#fffdf9",
  ["--panel2"]: "#fff4e7",
  ["--pill"]: "#f7ebdb",
  ["--pillActive"]: "#eaf6f4",
  ["--ink"]: "#1d232a",
  ["--muted"]: "#5a6672",
  ["--border"]: "#dccdb8",
  ["--shadow"]: "0 12px 30px rgba(32, 37, 42, 0.08)",
  ["--btn"]: "#f3e8d8",
  ["--danger"]: "#fff0f0",
  ["--dangerBorder"]: "#f2caca",
  ["--focus"]: "rgba(15, 118, 110, 0.28)",
};

export const internalPageStyle: React.CSSProperties = {
  ...internalThemeVars,
  background: "var(--bg)",
  minHeight: "100vh",
  color: "var(--ink)",
  padding: 24,
  fontFamily: 'var(--font-app-sans), "Trebuchet MS", "Segoe UI", sans-serif',
};

export const internalCardStyle: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 18,
  padding: 16,
  boxShadow: "var(--shadow)",
};

export const internalHeaderCardStyle: React.CSSProperties = {
  ...internalCardStyle,
  background: "var(--panel2)",
};

export const internalSmallTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
};

export const internalButtonStyle: React.CSSProperties = {
  padding: "10px 13px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--btn)",
  cursor: "pointer",
  fontWeight: 600,
  color: "var(--ink)",
};

export const internalDangerButtonStyle: React.CSSProperties = {
  ...internalButtonStyle,
  background: "var(--danger)",
  borderColor: "var(--dangerBorder)",
};

export const internalInputStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "white",
  color: "var(--ink)",
  outline: "none",
};

export function internalPillStyle(active: boolean): React.CSSProperties {
  return {
    border: "1px solid var(--border)",
    background: active ? "var(--pillActive)" : "var(--pill)",
    borderRadius: 12,
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
    textAlign: "center",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--ink)",
  };
}

export const internalFocusStyle = `
  input:focus, textarea:focus, select:focus {
    box-shadow: 0 0 0 4px var(--focus);
    border-color: #76b6ae;
  }
`;
