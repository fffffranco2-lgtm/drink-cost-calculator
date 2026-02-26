import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { pemEnvDebug, readPemFromEnv } from "@/lib/pem-env";

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

  const certificate = readPemFromEnv("QZ_CERT_PEM");
  if (!certificate) {
    console.error("[qz/certificate] QZ_CERT_PEM not configured", pemEnvDebug("QZ_CERT_PEM"));
    return NextResponse.json({ error: "QZ_CERT_PEM não configurado." }, { status: 500 });
  }

  return new NextResponse(certificate, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
