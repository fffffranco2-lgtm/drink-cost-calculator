import { createHmac } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type TableConfigRow = {
  id: string;
  name: string;
  code: string;
};

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

function buildQrUrl(row: TableConfigRow, origin: string) {
  const token = tableToken(row.code);
  const params = new URLSearchParams({ mesa: row.code });
  if (token) params.set("token", token);
  const link = `${origin}/?${params.toString()}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=800x800&margin=16&data=${encodeURIComponent(link)}`;
}

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
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

  const { data, error } = await supabase
    .from("table_configs")
    .select("id, name, code")
    .eq("id", tableId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Falha ao carregar mesa." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Mesa não encontrada." }, { status: 404 });
  }

  const row = data as TableConfigRow;
  const origin = detectOrigin(request);
  const qrUrl = buildQrUrl(row, origin);

  const qrRes = await fetch(qrUrl, { cache: "no-store" });
  if (!qrRes.ok) {
    return NextResponse.json({ error: "Falha ao gerar QR code para download." }, { status: 502 });
  }

  const bytes = await qrRes.arrayBuffer();
  const contentType = qrRes.headers.get("content-type") || "image/png";

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="mesa-${row.code}.png"`,
      "Cache-Control": "no-store",
    },
  });
}
