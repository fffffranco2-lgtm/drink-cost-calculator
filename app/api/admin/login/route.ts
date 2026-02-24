import { NextResponse } from "next/server";

const AUTH_COOKIE = "admin_auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const username = String(body?.username ?? "");
  const password = String(body?.password ?? "");

  if (username !== "admin" || password !== "admin") {
    return NextResponse.json({ ok: false, message: "Credenciais inválidas" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return res;
}
