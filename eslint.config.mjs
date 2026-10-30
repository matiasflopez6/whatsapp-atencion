import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "dist/**", "db/migrations/**", "next-env.d.ts"]),
  {
    // Todo acceso a datos de negocio pasa por withTenant() (lib/db/tenant.ts).
    // El pool/instancia base solo lo importan los módulos autorizados de abajo.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["@/lib/db", "@/lib/db/index"].map((name) => ({
            name,
            message:
              "No uses la conexión base directamente: usa withTenant() de @/lib/db/tenant o una operación de @/lib/db/system.",
          })),
        },
      ],
    },
  },
  {
    files: ["lib/db/**", "lib/auth.ts", "db/seed.ts", "scripts/**"],
    rules: { "no-restricted-imports": "off" },
  },
]);
