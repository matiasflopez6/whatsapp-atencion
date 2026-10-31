import { defineRailway, github, postgres, project, service } from "railway/iac";

// Infraestructura de Railway como código. Un solo archivo por proyecto: lo que no
// aparezca aquí se BORRA en el siguiente `railway config apply`.
// Sin UUIDs, sin dominios *.up.railway.app generados y sin secretos.
// Las referencias `ctx.shared.X` apuntan a variables compartidas que YA deben existir
// en el entorno (no las crea este archivo). Ver docs/deploy-railway.md.

const REPO = "matiasflopez6/whatsapp-atencion";

export default defineRailway((ctx) => {
  // Nombre con mayúscula inicial: las referencias `${{Postgres.*}}` distinguen mayúsculas.
  const db = postgres("Postgres");

  // Variables que necesitan web y cron-reprocess. BETTER_AUTH_SECRET también: getEnv() (lib/env.ts) la
  // valida y el cron ejecuta el agente, que la lee al procesar un mensaje.
  const common = {
    DATABASE_URL: db.env.DATABASE_URL, // red privada: postgres.railway.internal
    ENCRYPTION_KEY: ctx.shared.ENCRYPTION_KEY,
    BETTER_AUTH_SECRET: ctx.shared.BETTER_AUTH_SECRET,
    ANTHROPIC_API_KEY: ctx.shared.ANTHROPIC_API_KEY,
    GOOGLE_CLIENT_ID: ctx.shared.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: ctx.shared.GOOGLE_CLIENT_SECRET,
  };

  const web = service("web", {
    source: github(REPO, { branch: "main" }),
    build: "pnpm build",
    preDeploy: "pnpm db:migrate",
    start: "node .next/standalone/server.js",
    healthcheck: "/api/health",
    healthcheckTimeout: 60,
    env: {
      ...common,
      HOSTNAME: "0.0.0.0",
      // Opcionales, solo cuando existan en el entorno (si no, la referencia queda sin resolver):
      // EMAIL_PROVIDER_API_KEY: ctx.shared.EMAIL_PROVIDER_API_KEY,
      // EMAIL_FROM: ctx.shared.EMAIL_FROM,
      // APP_URL: "https://app.tudominio.com",
    },
    // Dominio propio opcional. No escribir el dominio *.up.railway.app generado.
    // domains: ctx.isEnvironment("production") ? ["app.tudominio.com"] : [],
  });

  // Job programado: arranca cada 5 min (UTC), reprocesa webhook_events y TERMINA (exit).
  // Si una ejecución sigue activa cuando toca la siguiente, Railway se salta la nueva.
  const cron = service("cron-reprocess", {
    source: github(REPO, { branch: "main" }),
    build: "pnpm build:scripts",
    // Bundle de `pnpm build:scripts` (esbuild, ESM): evita cargar tsx en producción.
    start: "node dist/scripts/reprocess-webhooks.js",
    deploy: { cronSchedule: "*/5 * * * *" },
    env: common,
  });

  return project("whatsapp-atencion", { resources: [db, web, cron] });
});
