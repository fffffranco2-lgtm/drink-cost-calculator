import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE = "admin_auth";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isLoginPage = pathname === "/admin/login";
  const isAdminArea = pathname.startsWith("/admin");

  if (!isAdminArea) return NextResponse.next();

  const isAuthenticated = req.cookies.get(AUTH_COOKIE)?.value === "1";

  if (!isAuthenticated && !isLoginPage) {
    const loginUrl = new URL("/admin/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthenticated && isLoginPage) {
    const adminUrl = new URL("/admin", req.url);
    return NextResponse.redirect(adminUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
