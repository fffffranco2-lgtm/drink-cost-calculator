"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { internalThemeVars } from "@/app/admin/internal-theme";
import type React from "react";

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: "/admin", label: "Custos & Cardápio" },
  { href: "/admin/pedidos", label: "Pedidos" },
  { href: "/admin/mesas", label: "Mesas" },
  { href: "/admin/impressao", label: "Impressão" },
  { href: "/admin/viabilidade", label: "Viabilidade" },
];

export function AdminNavBar() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/admin/login") return null;

  const handleLogout = async () => {
    const supabase = getSupabaseBrowserClient();
    await supabase?.auth.signOut();
    router.push("/admin/login");
  };

  const navStyle: React.CSSProperties = {
    ...internalThemeVars,
    background: "var(--panel2)",
    borderBottom: "1px solid var(--border)",
    padding: "8px 24px",
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  };

  const linkStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 12px",
    borderRadius: 10,
    border: `1px solid var(--border)`,
    background: active ? "var(--pillActive)" : "var(--btn)",
    color: "var(--ink)",
    textDecoration: "none",
    fontWeight: 600,
    fontSize: 13,
    display: "inline-flex",
    alignItems: "center",
  });

  return (
    <nav style={navStyle} aria-label="Navegação admin">
      {NAV_LINKS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          style={linkStyle(pathname === href || (href !== "/admin" && pathname.startsWith(href)))}
        >
          {label}
        </Link>
      ))}
      <div style={{ flex: 1 }} />
      <Link
        href="/"
        target="_blank"
        rel="noreferrer"
        style={linkStyle(false)}
      >
        Cardápio Público ↗
      </Link>
      <button
        onClick={handleLogout}
        style={{ ...linkStyle(false), cursor: "pointer" }}
      >
        Sair
      </button>
    </nav>
  );
}
