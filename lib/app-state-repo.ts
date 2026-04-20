/**
 * Repository para `app_state` com optimistic concurrency.
 *
 * Problema anterior: a página admin fazia `upsert` direto no Supabase usando
 * `user_id: "shared"`. Se dois admins editavam simultaneamente, last-write-wins
 * sobrescrevia o trabalho do outro silenciosamente.
 *
 * Solução: cada update envia o `updated_at` que o cliente tinha no momento da
 * leitura. O UPDATE só aplica se `updated_at` no banco ainda for igual. Se não
 * for, o cliente recebe `ConflictError` com o estado atual do servidor e decide
 * como reconciliar (normalmente re-hidratar e re-aplicar o diff).
 *
 * SQL necessário (ver supabase/migrations/20260420_app_state_updated_at.sql):
 *   - coluna `updated_at timestamptz not null default now()`
 *   - PK em `user_id`
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppStatePayload } from "@/app/admin/admin-types";

const SHARED_USER_ID = "shared";

export type AppStateRecord = {
  state: AppStatePayload;
  updatedAt: string; // ISO timestamp devolvido pelo banco
};

export class AppStateConflictError extends Error {
  readonly serverRecord: AppStateRecord | null;
  constructor(message: string, serverRecord: AppStateRecord | null) {
    super(message);
    this.name = "AppStateConflictError";
    this.serverRecord = serverRecord;
  }
}

/** Lê o estado atual + seu updated_at. Retorna null se ainda não existir. */
export async function loadAppState(
  supabase: SupabaseClient
): Promise<AppStateRecord | null> {
  const { data, error } = await supabase
    .from("app_state")
    .select("state, updated_at")
    .eq("user_id", SHARED_USER_ID)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    state: data.state as AppStatePayload,
    updatedAt: data.updated_at as string,
  };
}

/**
 * Tenta salvar `state`. Passe `expectedUpdatedAt` com o valor que você
 * tinha ao carregar. Se o banco mudou desde então, lança `AppStateConflictError`
 * e o chamador deve re-hidratar.
 *
 * Para primeira gravação (nada no banco ainda), passe `expectedUpdatedAt: null`.
 */
export async function saveAppState(
  supabase: SupabaseClient,
  state: AppStatePayload,
  expectedUpdatedAt: string | null
): Promise<AppStateRecord> {
  const nextUpdatedAt = new Date().toISOString();

  // Caso 1: ainda não existe row — insert condicional.
  if (expectedUpdatedAt === null) {
    const { data, error } = await supabase
      .from("app_state")
      .insert({ user_id: SHARED_USER_ID, state, updated_at: nextUpdatedAt })
      .select("state, updated_at")
      .single();

    if (error) {
      // Código 23505 = unique_violation: alguém criou antes.
      if ((error as { code?: string }).code === "23505") {
        const current = await loadAppState(supabase);
        throw new AppStateConflictError(
          "Outro admin criou o estado inicial antes. Recarregando...",
          current
        );
      }
      throw error;
    }

    return {
      state: data.state as AppStatePayload,
      updatedAt: data.updated_at as string,
    };
  }

  // Caso 2: update condicional — só aplica se updated_at ainda casar.
  const { data, error } = await supabase
    .from("app_state")
    .update({ state, updated_at: nextUpdatedAt })
    .eq("user_id", SHARED_USER_ID)
    .eq("updated_at", expectedUpdatedAt)
    .select("state, updated_at")
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    // Nenhuma linha atualizada = alguém mudou entre nossa leitura e nosso write.
    const current = await loadAppState(supabase);
    throw new AppStateConflictError(
      "Alterações foram feitas por outro admin. Recarregando...",
      current
    );
  }

  return {
    state: data.state as AppStatePayload,
    updatedAt: data.updated_at as string,
  };
}
