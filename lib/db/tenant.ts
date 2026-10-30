import { sql } from "drizzle-orm";
import { db, type Tx } from "./index";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Único camino para tocar tablas de negocio. Abre una transacción, asume el rol `app_runtime`
 * (sin BYPASSRLS) y fija `app.org_id`, de modo que incluso una query sin filtro solo ve datos de
 * esa organización (RLS). `SET LOCAL` y `set_config(..., true)` viven solo dentro de la transacción,
 * así que son seguros con PgBouncer en modo transaction.
 *
 * `organizationId` debe salir SIEMPRE de la sesión de Better Auth (panel) o del `phone_number_id`
 * resuelto (webhook), nunca de un parámetro que mande el cliente.
 */
export async function withTenant<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(organizationId)) throw new Error("organizationId inválido");
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_runtime`);
    await tx.execute(sql`select set_config('app.org_id', ${organizationId}, true)`);
    return fn(tx);
  });
}
