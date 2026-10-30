/**
 * Comprueba contra la base real que el aislamiento multi-tenant (withTenant + RLS bajo
 * app_runtime) y los triggers de NOTIFY funcionan. Requiere `pnpm db:seed`.
 * Uso: pnpm db:verify
 */
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { closePool, db } from "@/lib/db";
import { withTenant } from "@/lib/db/tenant";
import { appointments, contacts, conversations, messages, organizations } from "@/db/schema";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    const e = error as { cause?: { message?: string }; message: string };
    return e.cause?.message ?? e.message;
  }
}

async function main() {
  const orgs = await db.select().from(organizations);
  const [a, b] = [orgs.find((o) => o.name === "Clínica Dental Sonrisa"), orgs.find((o) => o.name === "Barbería Norte")];
  if (!a || !b) throw new Error("Falta el seed: ejecuta pnpm db:seed");

  // 1. Queries SIN filtro dentro de withTenant solo ven la propia organización.
  for (const [label, org, other] of [["A", a, b], ["B", b, a]] as const) {
    await withTenant(org.id, async (tx) => {
      const orgRows = await tx.select().from(organizations);
      check(`${label}: organizations sin filtro → solo la propia`, orgRows.length === 1 && orgRows[0]?.id === org.id);
      for (const [name, table] of [["contacts", contacts], ["conversations", conversations], ["messages", messages], ["appointments", appointments]] as const) {
        const rows = await tx.select({ org: table.organizationId }).from(table);
        check(`${label}: ${name} sin filtro → solo filas propias`, rows.length > 0 && rows.every((r) => r.org === org.id), `${rows.length} filas`);
      }
      // 2. Leer por id ajeno no devuelve nada.
      const foreign = await tx.select().from(contacts).where(sql`organization_id = ${other.id}`);
      check(`${label}: filtrar explícitamente por la otra org → 0 filas`, foreign.length === 0);
    });
  }

  // 3. Escribir en otra organización falla (WITH CHECK).
  const err = await rejects(() =>
    withTenant(a.id, (tx) => tx.insert(contacts).values({ organizationId: b.id, waPhone: "+0000000000" })),
  );
  check("A no puede insertar filas de B (WITH CHECK)", err !== null, err ?? "");

  // 4. UPDATE sin WHERE solo toca la propia org.
  await withTenant(a.id, (tx) => tx.update(contacts).set({ metadata: { verified: true } }));
  const bMeta = await withTenant(b.id, (tx) => tx.select({ m: contacts.metadata }).from(contacts));
  check("UPDATE sin WHERE de A no afecta a B", bMeta.every((r) => !(r.m as { verified?: boolean } | null)?.verified));
  await withTenant(a.id, (tx) => tx.update(contacts).set({ metadata: {} }));

  // 5. app_runtime no puede leer tablas de auth.
  const authErr = await rejects(() => withTenant(a.id, (tx) => tx.execute(sql`select * from "user"`)));
  check('app_runtime no puede leer "user"', authErr !== null && /permission denied/i.test(authErr), authErr ?? "");

  // 6. Sin app.org_id, el rol no ve nada.
  const none = await db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_runtime`);
    return tx.select().from(contacts);
  });
  check("app_runtime sin app.org_id → 0 filas", none.length === 0);

  // 7. El rol no tiene BYPASSRLS ni es superusuario.
  const role = await db.execute(sql`select rolsuper, rolbypassrls from pg_roles where rolname = 'app_runtime'`);
  check("app_runtime sin SUPERUSER/BYPASSRLS", role.rows[0]?.rolsuper === false && role.rows[0]?.rolbypassrls === false);

  // 8. Triggers NOTIFY: un mensaje nuevo emite org_events con solo IDs.
  const listener = new Client({ connectionString: process.env.DATABASE_URL });
  await listener.connect();
  await listener.query("LISTEN org_events");
  const received: Array<Record<string, string>> = [];
  listener.on("notification", (n) => n.payload && received.push(JSON.parse(n.payload)));
  const conv = await withTenant(a.id, async (tx) => {
    const [c] = await tx.select({ id: conversations.id }).from(conversations).limit(1);
    if (!c) throw new Error("sin conversación");
    await tx.insert(messages).values({ organizationId: a.id, conversationId: c.id, direction: "outbound", sender: "human", content: "verificación NOTIFY" });
    await tx.update(conversations).set({ botActive: false }).where(sql`id = ${c.id}`);
    await tx.update(conversations).set({ botActive: true }).where(sql`id = ${c.id}`);
    return c.id;
  });
  await new Promise((r) => setTimeout(r, 300));
  await listener.end();
  check("NOTIFY message.created con IDs", received.some((p) => p.type === "message.created" && p.organization_id === a.id && p.conversation_id === conv));
  check("NOTIFY conversation.updated", received.some((p) => p.type === "conversation.updated" && p.conversation_id === conv));
  await withTenant(a.id, (tx) => tx.delete(messages).where(sql`content = 'verificación NOTIFY'`));

  console.log(failures === 0 ? "\nAislamiento verificado." : `\n${failures} comprobaciones fallaron.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
