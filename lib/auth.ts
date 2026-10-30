import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import * as schema from "@/db/schema";
import { getEnv } from "@/lib/env";
import { db } from "@/lib/db";
import { ensureOrganizationForUser } from "@/lib/db/system";

/**
 * Instancia de Better Auth: email + contraseña, sesiones en Postgres (revocables), cookies httpOnly.
 * `getEnv()` se evalúa al importar este módulo, por lo que solo debe importarse desde código de
 * servidor en runtime (nunca desde lo que `next build` ejecute en tiempo de compilación).
 *
 * Magic link / reseteo de contraseña: pendientes de un proveedor de email (EMAIL_*). Cuando exista,
 * se añade `magicLink()` y `sendResetPassword` condicionados a `getEnv().emailEnabled`.
 */
const env = getEnv();

export const auth = betterAuth({
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
