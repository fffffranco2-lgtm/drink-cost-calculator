"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Container com scroll que exibe sombras suaves nas bordas quando há
 * conteúdo fora da área visível. Suporta eixo horizontal (x) e vertical (y).
 */
export function ScrollShadow(props: {
  axis: "x" | "y";
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const { axis, style, children } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const [showStart, setShowStart] = useState(false);
  const [showEnd, setShowEnd] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      if (axis === "x") {
        const max = el.scrollWidth - el.clientWidth;
        setShowStart(el.scrollLeft > 1);
        setShowEnd(max - el.scrollLeft > 1);
        return;
      }

      const max = el.scrollHeight - el.clientHeight;
      setShowStart(el.scrollTop > 1);
      setShowEnd(max - el.scrollTop > 1);
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [axis, children]);

  const viewportStyle: React.CSSProperties =
    axis === "x"
      ? { overflowX: "auto", overflowY: "hidden", ...style }
      : { overflowY: "auto", overflowX: "hidden", ...style };

  return (
    <div style={{ position: "relative" }}>
      <div ref={ref} style={viewportStyle}>{children}</div>

      {axis === "x" && showStart ? (
        <div
          style={{
            pointerEvents: "none",
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 14,
            background: "linear-gradient(to right, rgba(255,255,255,0.95), rgba(255,255,255,0))",
          }}
        />
      ) : null}
      {axis === "x" && showEnd ? (
        <div
          style={{
            pointerEvents: "none",
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 14,
            background: "linear-gradient(to left, rgba(255,255,255,0.95), rgba(255,255,255,0))",
          }}
        />
      ) : null}

      {axis === "y" && showStart ? (
        <div
          style={{
            pointerEvents: "none",
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 14,
            background: "linear-gradient(to bottom, rgba(255,255,255,0.95), rgba(255,255,255,0))",
          }}
        />
      ) : null}
      {axis === "y" && showEnd ? (
        <div
          style={{
            pointerEvents: "none",
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 14,
            background: "linear-gradient(to top, rgba(255,255,255,0.95), rgba(255,255,255,0))",
          }}
        />
      ) : null}
    </div>
  );
}
