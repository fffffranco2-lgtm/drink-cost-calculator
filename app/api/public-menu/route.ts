import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type AppStatePayload = {
  ingredients?: unknown[];
  drinks?: unknown[];
  settings?: unknown;
};

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ownerUserId = process.env.MENU_OWNER_USER_ID ?? process.env.NEXT_PUBLIC_MENU_OWNER_USER_ID;

  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Ambiente incompleto: configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    let state: AppStatePayload | null = null;

    if (ownerUserId) {
      const { data, error } = await supabase
        .from("app_state")
        .select("state")
        .eq("user_id", ownerUserId)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: "Falha ao consultar cardápio público no Supabase." }, { status: 500 });
      }

      state = (data?.state as AppStatePayload | null | undefined) ?? null;
    } else {
      const { data, error } = await supabase
        .from("app_state")
        .select("state")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: "Falha ao consultar cardápio público no Supabase." }, { status: 500 });
      }

      state = (data?.state as AppStatePayload | null | undefined) ?? null;
    }

    if (!state) {
      return NextResponse.json({ error: "Nenhum cardápio público encontrado no Supabase." }, { status: 404 });
    }

    return NextResponse.json({ state });
  } catch {
    return NextResponse.json({ error: "Erro inesperado ao carregar cardápio público." }, { status: 500 });
  }
}
