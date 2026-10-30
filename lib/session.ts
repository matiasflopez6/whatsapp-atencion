import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ensureOrganizationForUser, getUserOrganization } from "@/lib/db/system";
import type { Organization } from "@/db/types";

export type AppSession = {
  user: { id: string; name: string; email: string };
  organizationId: string;
  organization: Organization;
  role: "owner" | "staff";
};

/**
 * Verificación REAL de la sesión (proxy.ts solo hace una comprobación optimista de la cookie).
 * Devuelve el `organizationId` desde `profiles`: es la ÚNICA fuente válida para withTenant() en
 * el panel. Memoizada por petición.
 */
export const getSession = cache(async (): Promise<AppSession | null> => {
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result) return null;
  const { user } = result;

  // Red de seguridad: si el hook de signup falló a medias, completa el onboarding ahora.
  const membership =
    (await getUserOrganization(user.id)) ??
    (await ensureOrganizationForUser({ userId: user.id, fullName: user.name }));

  return {
    user: { id: user.id, name: user.name, email: user.email },
    organizationId: membership.organization.id,
    organization: membership.organization,
    role: membership.profile.role ?? "owner",
  };
});

/** Para layouts, páginas y Server Actions protegidos: redirige a /login si no hay sesión. */
export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
