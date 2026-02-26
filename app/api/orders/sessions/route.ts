import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

type SessionRow = {
  id: string;
  code: string;
  opened_at: string;
  closed_at: string | null;
};

type SessionOrderRow = {
  session_id: string | null;
  subtotal: number;
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

  const { data: sessionsData, error: sessionsError } = await supabase
    .from("order_sessions")
    .select("id, code, opened_at, closed_at")
    .order("opened_at", { ascending: false })
    .limit(30);

  if (sessionsError) {
    const msg = (sessionsError.message ?? "").toLowerCase();
    if (msg.includes("order_sessions") || msg.includes("does not exist") || msg.includes("not found")) {
      return NextResponse.json({ sessions: [] });
    }
    return NextResponse.json({ error: "Falha ao carregar histórico de sessões." }, { status: 500 });
  }

  const sessions = (sessionsData ?? []) as SessionRow[];
  if (!sessions.length) {
    return NextResponse.json({ sessions: [] });
  }

  const sessionIds = sessions.map((session) => session.id);
  const { data: ordersData, error: ordersError } = await supabase
    .from("orders")
    .select("session_id, subtotal")
    .in("session_id", sessionIds);

  if (ordersError) {
    const msg = (ordersError.message ?? "").toLowerCase();
    if (!msg.includes("session_id") && !msg.includes("does not exist") && !msg.includes("not found")) {
      return NextResponse.json({ error: "Falha ao carregar histórico de pedidos por sessão." }, { status: 500 });
    }
  }

  const acc = new Map<string, { ordersCount: number; subtotal: number }>();
  for (const session of sessions) {
    acc.set(session.id, { ordersCount: 0, subtotal: 0 });
  }

  for (const order of (ordersData ?? []) as SessionOrderRow[]) {
    if (!order.session_id) continue;
    const current = acc.get(order.session_id);
    if (!current) continue;
    current.ordersCount += 1;
    current.subtotal += Number(order.subtotal ?? 0);
  }

  return NextResponse.json({
    sessions: sessions.map((session) => {
      const totals = acc.get(session.id) ?? { ordersCount: 0, subtotal: 0 };
      return {
        id: session.id,
        code: session.code,
        openedAt: session.opened_at,
        closedAt: session.closed_at,
        isOpen: !session.closed_at,
        ordersCount: totals.ordersCount,
        subtotal: Math.round(totals.subtotal * 100) / 100,
      };
    }),
  });
}
