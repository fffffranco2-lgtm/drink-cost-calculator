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
        background: "#fbf7f0",
        padding: 24,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "#fffdf9",
          border: "1px solid #e7e1d8",
          borderRadius: 16,
          padding: 16,
          boxShadow: "0 6px 24px rgba(30, 30, 30, 0.06)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20 }}>Login administrativo</h1>
        <div style={{ fontSize: 12, color: "#6a6a6a" }}>Acesso à área interna</div>

        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail"
          autoComplete="email"
          style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #e7e1d8" }}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha"
          autoComplete="current-password"
          style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #e7e1d8" }}
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
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #e7e1d8",
            background: "#f6efe6",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}
