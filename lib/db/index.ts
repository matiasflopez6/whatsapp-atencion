import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

/**
 * Pool único por proceso + instancia Drizzle base (conectada como el usuario dueño de las tablas,
 * que ignora RLS). NO se importa fuera de lib/db, lib/auth.ts, db/seed.ts y scripts/ (regla de
 * ESLint): los datos de negocio se leen y escriben solo con withTenant() (./tenant.ts) y las
 * operaciones de sistema viven en ./system.ts.
 */
const globalForDb = globalThis as unknown as { __pgPool?: Pool };

function createPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está definida");
  const pool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  // Un error en un cliente inactivo no debe tumbar el proceso.
  pool.on("error", (err) => {
    console.error(JSON.stringify({ level: "error", msg: "pg pool error", error: err.message }));
  });
  return pool;
}

/**
 * Perezoso a propósito: `next build` importa los módulos de las rutas al recolectar datos de página y
 * en Railway el build no tiene DATABASE_URL. La conexión se crea en el primer uso real.
 */
function getPool(): Pool {
  // En dev, el singleton sobrevive al hot reload.
  return (globalForDb.__pgPool ??= createPool());
}

let drizzleDb: ReturnType<typeof createDb> | undefined;

function createDb() {
  return drizzle(getPool(), { schema });
}

export type Database = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const instance = (drizzleDb ??= createDb());
    const value = Reflect.get(instance, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/** Cierra el pool (SIGTERM en servicios y scripts). */
export async function closePool(): Promise<void> {
  await globalForDb.__pgPool?.end();
  globalForDb.__pgPool = undefined;
  drizzleDb = undefined;
}
