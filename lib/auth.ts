import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import * as schema from "@/db/schema";
import { getEnv } from "@/lib/env";
import { db } from "@/lib/db";
import { ensureOrganizationForUser } from "@/lib/db/system";

/**
 * Instancia de Better Auth: email + contraseña, sesiones en Postgres (revocables), cookies httpOnly.
 * Se crea en el primer uso (`getAuth()`), no al importar: `next build` importa las rutas para
 * recolectar datos de página y en Railway el build no tiene las variables de runtime.
 *
 * Magic link / reseteo de contraseña: pendientes de un proveedor de email (EMAIL_*). Cuando exista,
 * se añade `magicLink()` y `sendResetPassword` condicionados a `getEnv().emailEnabled`.
 */
function createAuth() {
  const env = getEnv();
  return betterAuth({
    baseURL: env.appUrl,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      autoSignIn: true,
    },
    databaseHooks: {
      user: {
        create: {
          // Signup → organización + agent_configs por defecto + profile, en una transacción.
          after: async (user, ctx) => {
            const organizationName =
              ctx && typeof ctx.body?.organizationName === "string" ? ctx.body.organizationName : undefined;
            await ensureOrganizationForUser({ userId: user.id, fullName: user.name, organizationName });
          },
        },
      },
    },
    // nextCookies debe ir el último: permite fijar cookies de sesión desde Server Actions.
    plugins: [nextCookies()],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  return (instance ??= createAuth());
}
