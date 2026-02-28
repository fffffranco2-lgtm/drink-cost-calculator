"use client";

import { FormEvent, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AdminLoginPage() {
  const supabase = getSupabaseBrowserClient();
  const isConfigured = Boolean(supabase);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (!supabase) {
        setError("Variáveis do Supabase não configuradas no deploy.");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError("Usuário ou senha inválidos.");
        return;
      }

      window.location.href = "/admin";
    } catch {
      setError("Não foi possível fazer login. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "transparent",
        padding: 24,
        fontFamily: 'var(--font-app-sans), "Trebuchet MS", "Segoe UI", sans-serif',
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "#fffdf9",
          border: "1px solid #dccdb8",
          borderRadius: 16,
          padding: 18,
          boxShadow: "0 12px 30px rgba(32, 37, 42, 0.08)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, letterSpacing: -0.4 }}>Login administrativo</h1>
        <div style={{ fontSize: 14, color: "#5a6672" }}>Acesso à área interna</div>

        <div>
          <label htmlFor="login-email" style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6, color: "#1d232a" }}>
            E-mail
          </label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            autoComplete="email"
            style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #dccdb8", color: "#111111", fontSize: 14 }}
          />
        </div>

        <div>
          <label htmlFor="login-password" style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6, color: "#1d232a" }}>
            Senha
          </label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #dccdb8", color: "#111111", fontSize: 14 }}
          />
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid #f2caca",
              background: "#fff0f0",
              color: "#7b1f1f",
              fontSize: 14,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 20, flexShrink: 0 }} aria-hidden>error</span>
            {error}
          </div>
        ) : null}
        {!isConfigured ? (
          <div
            role="alert"
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid #f2caca",
              background: "#fff0f0",
              color: "#7b1f1f",
              fontSize: 14,
            }}
          >
            Configure <code>NEXT_PUBLIC_SUPABASE_URL</code> e <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> no ambiente.
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading || !isConfigured}
          title={!isConfigured ? "Configure as variáveis do Supabase no ambiente" : undefined}
          style={{
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid #dccdb8",
            background: loading || !isConfigured ? "#a8b5b3" : "#0f766e",
            color: "white",
            cursor: loading || !isConfigured ? "not-allowed" : "pointer",
            fontWeight: 600,
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            minHeight: 44,
          }}
        >
          {loading ? (
            <>
              <span className="material-symbols-rounded" style={{ fontSize: 18, animation: "spin 0.8s linear infinite" }} aria-hidden>progress_activity</span>
              Entrando...
            </>
          ) : (
            "Entrar"
          )}
        </button>
      </form>
    </main>
  );
}
