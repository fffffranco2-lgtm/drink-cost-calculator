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

type UpdateTableBody = {
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

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Ambiente incompleto: configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const { id } = await context.params;
  const tableId = typeof id === "string" ? id.trim() : "";
  if (!tableId) {
    return NextResponse.json({ error: "Mesa inválida." }, { status: 400 });
  }

  let body: UpdateTableBody;
  try {
    body = (await request.json()) as UpdateTableBody;
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const name = sanitizeName(body.name);
  const code = normalizeCode(body.code);

  if (!name) {
    return NextResponse.json({ error: "Informe um nome válido para a mesa." }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: "Código da mesa inválido." }, { status: 400 });
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("table_configs")
    .update({ name, code })
    .eq("id", tableId)
    .select("id, name, code, created_at, updated_at")
    .maybeSingle();

  if (error) {
    const msg = (error.message ?? "").toLowerCase();
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json({ error: "Já existe outra mesa com esse código." }, { status: 409 });
    }
    return NextResponse.json({ error: "Falha ao atualizar mesa." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Mesa não encontrada." }, { status: 404 });
  }

  const origin = detectOrigin(request);
  return NextResponse.json({
    table: buildTablePresentation(data as TableConfigRow, origin),
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Ambiente incompleto: configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const { id } = await context.params;
  const tableId = typeof id === "string" ? id.trim() : "";
  if (!tableId) {
    return NextResponse.json({ error: "Mesa inválida." }, { status: 400 });
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await supabase.from("table_configs").delete().eq("id", tableId);

  if (error) {
    return NextResponse.json({ error: "Falha ao remover mesa." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
