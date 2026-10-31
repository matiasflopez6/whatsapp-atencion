import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/** Scope único de v1 (FreeBusy + crear eventos + listar calendarios). Ver docs/decisions.md. */
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super("Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor");
    this.name = "GoogleNotConfiguredError";
  }
}

/** El refresh token fue revocado o caducó (`invalid_grant`): hay que reconectar. */
export class GoogleAuthError extends Error {
  constructor(message = "La conexión con Google Calendar ya no es válida") {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export function googleCredentials(): { clientId: string; clientSecret: string } | null {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = getEnv();
  return GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET ? { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET } : null;
}

function requireCredentials() {
  const credentials = googleCredentials();
  if (!credentials) throw new GoogleNotConfiguredError();
  return credentials;
}

export function redirectUri(): string {
  return `${getEnv().appUrl}/api/auth/google/callback`;
}

// ── state anti-CSRF: organización + nonce + caducidad, firmado con HMAC ───────────────────────────

const STATE_TTL_MS = 10 * 60 * 1000;

function sign(data: string): string {
  return createHmac("sha256", getEnv().BETTER_AUTH_SECRET).update(`google-oauth:${data}`).digest("base64url");
}

export function createState(organizationId: string): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  const data = Buffer.from(JSON.stringify({ o: organizationId, n: nonce, e: Date.now() + STATE_TTL_MS })).toString("base64url");
  return { state: `${data}.${sign(data)}`, nonce };
}

/** Devuelve la organización del state si la firma, la caducidad y el nonce de la cookie coinciden. */
export function readState(state: string, cookieNonce: string | undefined): string | null {
  const [data, signature] = state.split(".");
  if (!data || !signature || !cookieNonce) return null;
  const expected = Buffer.from(sign(data));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as { o?: string; n?: string; e?: number };
    if (!parsed.o || parsed.n !== cookieNonce || !parsed.e || parsed.e < Date.now()) return null;
    return parsed.o;
  } catch {
    return null;
  }
}

export function buildAuthUrl(state: string): string {
  const { clientId } = requireCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

// ── tokens ───────────────────────────────────────────────────────────────────────────────────────

export type TokenResponse = { accessToken: string; refreshToken?: string; expiresAt: Date; scope?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret } = requireCredentials();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !json.access_token) {
    if (json.error === "invalid_grant") throw new GoogleAuthError();
    throw new Error(`Google OAuth: ${json.error_description ?? json.error ?? response.status}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
    scope: json.scope,
  };
}

export const exchangeCode = (code: string) =>
  tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });

export const refreshAccessToken = (refreshToken: string) =>
  tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });

/** Revoca el token en Google (mejor esfuerzo, al desconectar). */
export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}
