import { defineConfig } from "drizzle-kit";

// drizzle-kit no lee .env.local por sí mismo (Next sí). En Railway la variable ya viene del entorno.
try {
  process.loadEnvFile(".env.local");
} catch {
  // sin .env.local: se usan las variables del entorno
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL no está definida");

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dbCredentials: { url },
});
