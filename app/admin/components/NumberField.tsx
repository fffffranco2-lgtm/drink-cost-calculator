"use client";

import { useEffect, useState } from "react";

/** parse input pt-BR; retorna null se vazio ou inválido */
function parseNumberLoose(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const norm = t.replace(/\./g, "").replace(",", "."); // permite 1.234,56
  const v = Number(norm);
  return Number.isFinite(v) ? v : null;
}

/** formata número para exibição no input */
function formatFixed(n: number, decimals: number) {
  return n.toFixed(decimals).replace(".", ",");
}

/** Campo numérico que aceita input em pt-BR e emite o valor ao perder o foco */
export function NumberField(props: {
  value: number;
  onCommit: (n: number) => void;
  decimals: number; // 2 para preço; 0 para ml
  min?: number;
  max?: number;
  style?: React.CSSProperties;
  inputMode?: "decimal" | "numeric";
}) {
  const { value, onCommit, decimals, min, max, style, inputMode } = props;
  const [text, setText] = useState<string>(formatFixed(value, decimals));
  const [focused, setFocused] = useState(false);

  // sincroniza com valor externo quando não está editando
  useEffect(() => {
    if (!focused) setText(formatFixed(value, decimals));
  }, [value, decimals, focused]);

  const commit = () => {
    const parsed = parseNumberLoose(text);
    if (parsed === null) {
      // volta pro valor atual se vazio/inválido
      setText(formatFixed(value, decimals));
      return;
    }
    let n = parsed;
    if (typeof min === "number") n = Math.max(min, n);
    if (typeof max === "number") n = Math.min(max, n);

    // normaliza casas decimais
    const factor = Math.pow(10, decimals);
    n = Math.round(n * factor) / factor;

    onCommit(n);
    setText(formatFixed(n, decimals));
  };

  return (
    <input
      style={style}
      inputMode={inputMode ?? "decimal"}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setText(formatFixed(value, decimals));
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
