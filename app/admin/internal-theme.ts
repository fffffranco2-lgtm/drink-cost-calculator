import type React from "react";

/**
 * Tokens de tema do admin agora são apenas aliases que consomem as
 * CSS variables definidas em globals.css. Nada mais é redeclarado aqui:
 * isso elimina o conflito entre os dois sistemas de cor que existia
 * quando `page.tsx` também escrevia `--bg`, `--panel`, etc.
 *
 * Os nomes `internal*` permanecem para preservar a API pública do módulo.
 */

type ThemeVars = React.CSSProperties & Record<`--${string}`, string>;

/**
 * Mantido como objeto vazio tipado: o tema já está aplicado via :root em
 * globals.css, mas alguns lugares ainda spread `internalThemeVars` no style
 * inline. Deixá-lo vazio mantém esses call sites funcionando.
 */
export const internalThemeVars: ThemeVars = {};

export const internalPageStyle: React.CSSProperties = {
  backgroundColor: "var(--bg)",
  minHeight: "100vh",
  color: "var(--ink)",
  padding: 24,
  fontFamily: 'var(--font-app-sans), "Trebuchet MS", "Segoe UI", sans-serif',
};

export const internalCardStyle: React.CSSProperties = {
  backgroundColor: "var(--panel)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  borderRadius: 18,
  padding: 16,
  boxShadow: "var(--shadow)",
};

export const internalHeaderCardStyle: React.CSSProperties = {
  ...internalCardStyle,
  backgroundColor: "var(--panel2)",
};

export const internalSmallTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
};

export const internalButtonStyle: React.CSSProperties = {
  padding: "10px 13px",
  borderRadius: 12,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  backgroundColor: "var(--btn)",
  cursor: "pointer",
  fontWeight: 600,
  color: "var(--ink)",
};

export const internalDangerButtonStyle: React.CSSProperties = {
  ...internalButtonStyle,
  backgroundColor: "var(--danger-bg)",
  borderColor: "var(--danger-border)",
};

export const internalInputStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 12,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  background: "white",
  color: "var(--ink)",
  outline: "none",
};

export function internalPillStyle(active: boolean): React.CSSProperties {
  return {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    backgroundColor: active ? "var(--pillActive)" : "var(--pill)",
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

/**
 * Deprecated: foco agora está em globals.css. Mantido exportado para
 * eventual callers ainda fazerem `<style>{internalFocusStyle}</style>`,
 * mas não é mais necessário.
 */
export const internalFocusStyle = "";
