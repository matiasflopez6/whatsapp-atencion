import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Comprobación OPTIMISTA (solo existencia de la cookie): la verificación real ocurre en el servidor
// con getSession() en cada layout, página, Server Action y Route Handler protegido.
const PROTECTED = ["/dashboard", "/citas", "/conversaciones", "/personalizacion", "/integraciones"];
const AUTH_PAGES = ["/login", "/signup"];

const matches = (pathname: string, bases: string[]) =>
  bases.some((base) => pathname === base || pathname.startsWith(`${base}/`));

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  if (!hasSession && matches(pathname, PROTECTED)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (hasSession && matches(pathname, AUTH_PAGES)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/citas/:path*", "/conversaciones/:path*", "/personalizacion/:path*", "/integraciones/:path*", "/login", "/signup"],
};
