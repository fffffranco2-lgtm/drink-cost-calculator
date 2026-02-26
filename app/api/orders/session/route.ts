import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

type SessionRow = {
  id: string;
  code: string;
  opened_at: string;
  closed_at: string | null;
};

function readCookies(request: Request) {
  const raw = request.headers.get("cookie") ?? "";
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf("=");
      if (idx < 0) return { name: pair, value: "" };
      return { name: pair.slice(0, idx), value: decodeURIComponent(pair.slice(idx + 1)) };
    });
}

async function requireAdminUser(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return { error: NextResponse.json({ error: "Ambiente incompleto para autenticação do admin." }, { status: 500 }) };
  }

  const cookieStore = readCookies(request);
  const supabaseAuth = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore;
      },
      setAll() {
        // sem mutação de cookie nesse fluxo
      },
    },
  });

  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) };
  }

  return { user };
}

function makeSessionCode() {
  const now = new Date();
  const y = now.getFullYear().toString();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `BAR-${y}${m}${d}-${hh}${mm}`;
}

async function getActiveSession(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("order_sessions")
    .select("id, code, opened_at, closed_at")
    .is("closed_at", null)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { error };
  return { session: (data as SessionRow | null | undefined) ?? null };
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdminUser(request);
  if (auth.error) return auth.error;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Ambiente incompleto: configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await getActiveSession(supabase);
  if (result.error) {
    return NextResponse.json({ error: "Falha ao consultar sessão do bar." }, { status: 500 });
  }

  if (!result.session) {
    return NextResponse.json({ isOpen: false, session: null });
  }

  return NextResponse.json({
    isOpen: true,
    session: {
      id: result.session.id,
      code: result.session.code,
      openedAt: result.session.opened_at,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireAdminUser(request);
  if (auth.error) return auth.error;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Ambiente incompleto: configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const current = await getActiveSession(supabase);
  if (current.error) {
    return NextResponse.json({ error: "Falha ao consultar sessão do bar." }, { status: 500 });
  }
  if (current.session) {
    return NextResponse.json({
      isOpen: true,
      session: { id: current.session.id, code: current.session.code, openedAt: current.session.opened_at },
    });
  }

  const { data, error } = await supabase
    .from("order_sessions")
    .insert({ code: makeSessionCode() })
    .select("id, code, opened_at, closed_at")
    .single<SessionRow>();

  if (error || !data) {
    return NextResponse.json({ error: "Falha ao abrir o bar." }, { status: 500 });
  }

  return NextResponse.json({
    isOpen: true,
    session: { id: data.id, code: data.code, openedAt: data.opened_at },
  });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminUser(request);
  if (auth.error) return auth.error;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Ambiente incompleto: configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const current = await getActiveSession(supabase);
  if (current.error) {
    return NextResponse.json({ error: "Falha ao consultar sessão do bar." }, { status: 500 });
  }
  if (!current.session) {
    return NextResponse.json({ isOpen: false, session: null });
  }

  const { data, error } = await supabase
    .from("order_sessions")
    .update({ closed_at: new Date().toISOString() })
    .eq("id", current.session.id)
    .select("id, code, opened_at, closed_at")
    .single<SessionRow>();

  if (error || !data) {
    return NextResponse.json({ error: "Falha ao fechar o bar." }, { status: 500 });
  }

  return NextResponse.json({
    isOpen: false,
    session: { id: data.id, code: data.code, openedAt: data.opened_at, closedAt: data.closed_at },
  });
}
