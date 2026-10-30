import { NextResponse, type NextRequest } from "next/server";
import { googleCalendarConfigs } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { withTenant } from "@/lib/db/tenant";
import { fetchPrimaryCalendar } from "@/lib/google/calendar";
import { exchangeCode, GoogleNotConfiguredError, readState } from "@/lib/google/oauth";
import { errorMessage, log } from "@/lib/logger";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// El host de `request.url` en el standalone (HOSTNAME=0.0.0.0) no es el público: se usa la URL de la app.
const absolute = (path: string) => new URL(path, getEnv().appUrl);

/** Callback de Google. Valida state + nonce de cookie, y exige que la organización del state sea la de la sesión. */
export async function GET(request: NextRequest) {
  const done = (code: string) => {
    const response = NextResponse.redirect(absolute(`/integraciones?google=${code}`));
    response.cookies.delete({ name: "google_oauth_nonce", path: "/api/auth/google" });
    return response;
  };

  const session = await getSession();
  if (!session) return NextResponse.redirect(absolute("/login"));

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return done("denied");
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return done("invalid");

  const organizationId = readState(state, request.cookies.get("google_oauth_nonce")?.value);
  if (!organizationId || organizationId !== session.organizationId) {
    log.warn("google oauth: state inválido", { organizationId: session.organizationId });
    return done("invalid");
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refreshToken) return done("no_refresh_token");
    const primary = await fetchPrimaryCalendar(tokens.accessToken);

    await withTenant(organizationId, (tx) =>
      tx
        .insert(googleCalendarConfigs)
        .values({
          organizationId,
          calendarId: primary.id,
          refreshTokenEncrypted: encrypt(tokens.refreshToken!),
          accessTokenEncrypted: encrypt(tokens.accessToken),
          tokenExpiresAt: tokens.expiresAt,
          accountEmail: primary.id,
          status: "connected",
        })
        .onConflictDoUpdate({
          target: googleCalendarConfigs.organizationId,
          // Al reconectar se conserva el calendar_id que el dueño ya había elegido.
          set: {
            refreshTokenEncrypted: encrypt(tokens.refreshToken!),
            accessTokenEncrypted: encrypt(tokens.accessToken),
            tokenExpiresAt: tokens.expiresAt,
            accountEmail: primary.id,
            status: "connected",
            lastError: null,
            updatedAt: new Date(),
          },
        }),
    );
    log.info("google calendar conectado", { organizationId });
    return done("connected");
  } catch (error) {
    log.error("google oauth: fallo en el callback", { organizationId, error: errorMessage(error) });
    return done(error instanceof GoogleNotConfiguredError ? "not_configured" : "error");
  }
}
