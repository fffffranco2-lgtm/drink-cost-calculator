"use client";

import Link from "next/link";

type BreadcrumbItem = { label: string; href?: string };

type AdminHeaderProps = {
  title: string;
  subtitle?: string;
  currentPage?: "admin" | "mesas" | "pedidos" | "historico";
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
};

const navItems = [
  { href: "/admin", label: "Área interna", page: "admin" as const },
  { href: "/admin/mesas", label: "Mesas", page: "mesas" as const },
  { href: "/admin/pedidos", label: "Pedidos", page: "pedidos" as const },
  { href: "/admin/pedidos/historico", label: "Histórico", page: "historico" as const },
];

export function AdminHeader({ title, subtitle, currentPage, breadcrumbs, actions }: AdminHeaderProps) {
  const btnBase = {
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid var(--border, #d8dee5)",
    background: "white",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 14,
    textDecoration: "none" as const,
    display: "inline-flex" as const,
    alignItems: "center" as const,
    color: "var(--ink, #141414)",
  };

  const activeStyle = {
    ...btnBase,
    background: "var(--pillActive, #eaf6f4)",
    borderColor: "var(--accent, #0f766e)",
  };

  const defaultBreadcrumbs: BreadcrumbItem[] = breadcrumbs ?? [
    { label: "Admin", href: "/admin" },
    ...(currentPage === "historico" ? [{ label: "Pedidos", href: "/admin/pedidos" }] : []),
    { label: currentPage === "admin" ? "Área interna" : currentPage === "mesas" ? "Mesas" : currentPage === "pedidos" ? "Pedidos" : "Histórico" },
  ];

  return (
    <div
      style={{
        background: "var(--panel, #ffffff)",
        border: "1px solid var(--border, #d8dee5)",
        borderRadius: 16,
        padding: 16,
        marginBottom: 14,
      }}
    >
      {defaultBreadcrumbs.length > 1 ? (
        <nav aria-label="Breadcrumb" style={{ marginBottom: 8, fontSize: 14, color: "var(--muted, #67707a)" }}>
          {defaultBreadcrumbs.map((item, i) => (
            <span key={i}>
              {i > 0 && <span style={{ margin: "0 6px" }}>›</span>}
              {item.href && i < defaultBreadcrumbs.length - 1 ? (
                <Link href={item.href} style={{ color: "inherit", textDecoration: "none" }}>
                  {item.label}
                </Link>
              ) : (
                <span style={{ color: "var(--ink, #141414)", fontWeight: 600 }}>{item.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: -0.2 }}>{title}</h1>
          {subtitle ? (
            <div style={{ fontSize: 14, color: "var(--muted, #67707a)", marginTop: 4 }}>{subtitle}</div>
          ) : null}
        </div>
        {actions}
      </div>
      <nav
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}
        aria-label="Navegação principal"
      >
        {navItems.map((item) => {
          const isActive = currentPage === item.page;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={isActive ? activeStyle : btnBase}
              aria-current={isActive ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
