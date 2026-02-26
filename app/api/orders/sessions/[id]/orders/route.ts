import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

type OrderStatus = "pendente" | "em_progresso" | "concluido";
type OrderSource = "mesa_qr" | "balcao";

type SessionOrderRow = {
  id: string;
  code: string;
  status: OrderStatus;
  source: OrderSource | null;
  table_code: string | null;
  subtotal: number;
  created_at: string;
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

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
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

  const { id } = await context.params;
  const sessionId = typeof id === "string" ? id.trim() : "";
  if (!sessionId) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 400 });
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("orders")
    .select("id, code, status, source, table_code, subtotal, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Falha ao carregar pedidos da sessão." }, { status: 500 });
  }

  const orders = ((data ?? []) as SessionOrderRow[]).map((order) => ({
    id: order.id,
    code: order.code,
    status: order.status,
    source: order.source === "mesa_qr" ? "mesa_qr" : "balcao",
    tableCode: order.source === "mesa_qr" ? order.table_code : null,
    subtotal: order.subtotal,
    createdAt: order.created_at,
  }));

  return NextResponse.json({ orders });
}
