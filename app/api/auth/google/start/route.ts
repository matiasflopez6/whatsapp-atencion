import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { buildAuthUrl, createState, googleCredentials } from "@/lib/google/oauth";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// El host de `request.url` en el standalone (HOSTNAME=0.0.0.0) no es el público: se usa la URL de la app.
const absolute = (path: string) => new URL(path, getEnv().appUrl);

const COOKIE = "google_oauth_nonce";

/** Inicia el OAuth de Google Calendar para la organización de la sesión (nunca de la query). */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.redirect(absolute("/login"));
  if (!googleCredentials()) return NextResponse.redirect(absolute("/integraciones?google=not_configured"));

  const { state, nonce } = createState(session.organizationId);
  const response = NextResponse.redirect(buildAuthUrl(state));
  response.cookies.set(COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return response;
}
