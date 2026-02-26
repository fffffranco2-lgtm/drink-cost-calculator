import { createHmac } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type TableConfigRow = {
  id: string;
  name: string;
  code: string;
  created_at: string;
  updated_at: string;
};

type CreateTableBody = {
  name?: string;
  code?: string;
};

function normalizeCode(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toUpperCase().replace(/\s+/g, "_");
  if (!cleaned) return null;
  if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(cleaned)) return null;
  return cleaned;
}

function slugifyCodeFromName(name: string) {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);

  return base || "MESA";
}

function sanitizeName(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 80);
}

function tableToken(code: string) {
  const secret = process.env.TABLE_QR_SIGNING_SECRET?.trim();
  if (!secret) return null;
  return createHmac("sha256", secret).update(code).digest("hex");
}

function detectOrigin(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();
  const proto = forwardedProto || (host?.includes("localhost") ? "http" : "https");

  if (host) return `${proto}://${host}`;

  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/$/, "");

  return "http://localhost:3000";
}

function buildTablePresentation(row: TableConfigRow, origin: string) {
  const token = tableToken(row.code);
  const params = new URLSearchParams({ mesa: row.code });
  if (token) params.set("token", token);

  const link = `${origin}/?${params.toString()}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&data=${encodeURIComponent(link)}`;

  return {
    id: row.id,
    name: row.name,
    code: row.code,
    link,
    qrCodeUrl,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function resolveAvailableCode(supabase: ReturnType<typeof createClient>, preferred: string) {
  for (let i = 0; i < 100; i += 1) {
    const suffix = i === 0 ? "" : `_${String(i + 1)}`;
    const maxBaseLen = 20 - suffix.length;
    if (maxBaseLen <= 0) break;

    const candidate = `${preferred.slice(0, maxBaseLen)}${suffix}`;
    const { data, error } = await supabase
      .from("table_configs")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return candidate;
    }
  }

  throw new Error("Não foi possível gerar um código único para a mesa.");
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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

  const { data, error } = await supabase
    .from("table_configs")
    .select("id, name, code, created_at, updated_at")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Falha ao carregar mesas." }, { status: 500 });
  }

  const origin = detectOrigin(request);
  const rows = (data ?? []) as TableConfigRow[];
  return NextResponse.json({
    tables: rows.map((row) => buildTablePresentation(row, origin)),
  });
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Ambiente incompleto: configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  let body: CreateTableBody;
  try {
    body = (await request.json()) as CreateTableBody;
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const name = sanitizeName(body.name);
  if (!name) {
    return NextResponse.json({ error: "Informe um nome válido para a mesa." }, { status: 400 });
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const preferredCode = normalizeCode(body.code) ?? slugifyCodeFromName(name);

  let code: string;
  try {
    code = await resolveAvailableCode(supabase, preferredCode);
  } catch {
    return NextResponse.json({ error: "Não foi possível gerar um código único para a mesa." }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("table_configs")
    .insert({ name, code })
    .select("id, name, code, created_at, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Falha ao criar mesa." }, { status: 500 });
  }

  const origin = detectOrigin(request);
  return NextResponse.json({
    table: buildTablePresentation(data as TableConfigRow, origin),
  });
}
