import { z } from "zod";

/**
 * Validación de variables de entorno con Zod. Se evalúa de forma perezosa (primer uso) para que
 * `next build` no exija secretos de runtime; `instrumentation.ts` la fuerza al arrancar el servidor
 * para fallar rápido si falta alguna obligatoria.
 *
 * Opcionales hoy porque aún no hay código que las use: ANTHROPIC_API_KEY, GOOGLE_*.
 * Cada hilo que las consuma debe volverlas obligatorias aquí.
 */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET debe tener 32+ caracteres"),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "ENCRYPTION_KEY debe ser 32 bytes en base64"),
  ANTHROPIC_API_KEY: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  EMAIL_PROVIDER_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  APP_URL: optionalString,
  RAILWAY_PUBLIC_DOMAIN: optionalString,
});

export type Env = z.infer<typeof schema> & { appUrl: string; emailEnabled: boolean };

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Variables de entorno inválidas:\n${detail}`);
  }
  const e = parsed.data;
  // URL pública: APP_URL > dominio de Railway > localhost. Siempre se calcula en servidor.
  const appUrl = (
    e.APP_URL ?? (e.RAILWAY_PUBLIC_DOMAIN ? `https://${e.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:3000")
  ).replace(/\/$/, "");
  cached = { ...e, appUrl, emailEnabled: Boolean(e.EMAIL_PROVIDER_API_KEY && e.EMAIL_FROM) };
  return cached;
}
