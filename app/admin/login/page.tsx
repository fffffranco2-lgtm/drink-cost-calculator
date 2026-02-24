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
        <div style={{ fontSize: 12, color: "#5a6672" }}>Acesso à área interna</div>

        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail"
          autoComplete="email"
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #dccdb8", color: "#111111" }}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha"
          autoComplete="current-password"
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #dccdb8", color: "#111111" }}
        />

        {error ? <div style={{ fontSize: 12, color: "#b00020" }}>{error}</div> : null}
        {!isConfigured ? (
          <div style={{ fontSize: 12, color: "#b00020" }}>
            Configure `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` no ambiente.
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading || !isConfigured}
          style={{
            padding: "10px 13px",
            borderRadius: 12,
            border: "1px solid #dccdb8",
            background: "#f3e8d8",
            cursor: loading ? "wait" : "pointer",
            fontWeight: 600,
          }}
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}
