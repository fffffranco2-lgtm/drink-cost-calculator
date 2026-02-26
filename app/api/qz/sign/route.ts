import { createSign } from "crypto";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { pemEnvDebug, readPemFromEnv } from "@/lib/pem-env";

type SignBody = {
  toSign?: string;
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

export async function POST(request: Request) {
  const auth = await requireAdminUser(request);
  if (auth.error) return auth.error;

  let body: SignBody;
  try {
    body = (await request.json()) as SignBody;
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const toSign = typeof body.toSign === "string" ? body.toSign : "";
  if (!toSign || toSign.length > 20_000) {
    return NextResponse.json({ error: "Campo toSign inválido." }, { status: 400 });
  }

  const privateKey = readPemFromEnv("QZ_PRIVATE_KEY_PEM");
  if (!privateKey) {
    console.error("[qz/sign] QZ_PRIVATE_KEY_PEM not configured", pemEnvDebug("QZ_PRIVATE_KEY_PEM"));
    return NextResponse.json({ error: "QZ_PRIVATE_KEY_PEM não configurado." }, { status: 500 });
  }

  try {
    const signer = createSign("SHA512");
    signer.update(toSign, "utf8");
    signer.end();
    const signature = signer.sign(privateKey, "base64");
    return NextResponse.json({ signature }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Falha ao assinar payload do QZ." }, { status: 500 });
  }
}
