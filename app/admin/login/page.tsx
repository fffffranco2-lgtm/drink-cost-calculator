"use client";

import { FormEvent, useState } from "react";
import {
  internalButtonStyle,
  internalCardStyle,
  internalFocusStyle,
  internalInputStyle,
  internalPageStyle,
  internalSmallTextStyle,
} from "@/app/admin/internal-theme";
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
        ...internalPageStyle,
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <style>{internalFocusStyle}</style>
      <form
        onSubmit={onSubmit}
        style={{
          ...internalCardStyle,
          width: "100%",
          maxWidth: 360,
          borderRadius: 16,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, letterSpacing: -0.4 }}>Login administrativo</h1>
        <div style={{ ...internalSmallTextStyle }}>Acesso à área interna</div>

        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail"
          autoComplete="email"
          style={{ ...internalInputStyle }}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha"
          autoComplete="current-password"
          style={{ ...internalInputStyle }}
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
            ...internalButtonStyle,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}
