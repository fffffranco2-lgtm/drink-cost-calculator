import { ReactNode } from "react";

type Props = {
  children: ReactNode;
  width?: number;
};

export function Drawer({ children, width = 500 }: Props) {
  return (
    <div
      style={{
        width,
        flexShrink: 0,
        position: "sticky",
        top: 0,
        maxHeight: "100vh",
        alignSelf: "start",
        overflowY: "auto",
        backgroundColor: "var(--surface)",
        borderLeft: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: 24, display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}
