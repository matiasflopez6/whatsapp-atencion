/**
 * Panel en tiempo real: listener LISTEN/NOTIFY (aislamiento entre organizaciones y reconexión),
 * consultas del panel bajo RLS, sandbox sin efectos, validación de configuración y rejilla del calendario.
 * Requiere DATABASE_URL con las migraciones aplicadas.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
process.env.BETTER_AUTH_SECRET ??= "y".repeat(40);
delete process.env.ANTHROPIC_API_KEY;

const { eq, sql } = await import("drizzle-orm");
const { db, closePool } = await import("@/lib/db");
const schema = await import("@/db/schema");
const { withTenant } = await import("@/lib/db/tenant");
const { RealtimeListener, parseNotification } = await import("@/lib/realtime/listener");
const { listConversations, getConversation, listMessages } = await import("@/lib/panel/conversations");
const { listAppointments } = await import("@/lib/panel/appointments");
const { getDashboard } = await import("@/lib/panel/dashboard");
const { runSandbox } = await import("@/lib/agent/sandbox");
const { agentConfigSchema, describeIssue } = await import("@/lib/panel/agent-config-schema");
const { monthGrid, visibleRange, layoutDay, shift, weekDays } = await import("@/lib/panel/calendar-grid");
const { replyWindowOpen } = await import("@/lib/panel/reply-window");

const uuid = "123e4567-e89b-42d3-a456-426614174000";

describe("parseNotification", () => {
  it("acepta payloads válidos y descarta el resto", () => {
    const ok = parseNotification(JSON.stringify({ organization_id: uuid, conversation_id: uuid, type: "message.created", id: uuid }));
    assert.deepEqual(ok, { organizationId: uuid, event: { type: "message.created", id: uuid, conversationId: uuid } });
    assert.equal(parseNotification(JSON.stringify({ organization_id: uuid, type: "appointment.changed", id: uuid }))?.event.conversationId, undefined);
    assert.equal(parseNotification("no es json"), null);
    assert.equal(parseNotification(undefined), null);
    assert.equal(parseNotification(JSON.stringify({ organization_id: "x", type: "message.created", id: uuid })), null);
    assert.equal(parseNotification(JSON.stringify({ organization_id: uuid, type: "otro", id: uuid })), null);
  });
});

describe("calendario", () => {
  it("construye semanas completas lunes-domingo", () => {
    const grid = monthGrid({ year: 2026, month: 10, day: 30 });
    assert.equal(grid.length, 5);
    assert.deepEqual(grid[0]![0], { year: 2026, month: 9, day: 28 }); // 1 oct 2026 es jueves
    assert.deepEqual(grid[4]![6], { year: 2026, month: 11, day: 1 });
    assert.equal(weekDays({ year: 2026, month: 10, day: 30 })[0]!.day, 26);
  });

  it("calcula el rango visible a medianoche de la zona del negocio", () => {
    const { from, to } = visibleRange("week", { year: 2026, month: 10, day: 30 }, "America/Mexico_City");
    assert.equal(from.toISOString(), "2026-10-26T06:00:00.000Z"); // UTC-6 en octubre (DST termina el 25 oct 2026)
    assert.equal(to.getTime() - from.getTime(), 7 * 24 * 3600 * 1000);
    assert.deepEqual(shift("month", { year: 2026, month: 1, day: 31 }, 1), { year: 2026, month: 2, day: 1 });
    assert.deepEqual(shift("week", { year: 2026, month: 12, day: 30 }, 1), { year: 2027, month: 1, day: 6 });
  });

  it("reparte en columnas los eventos que se solapan", () => {
    const placed = layoutDay(
      [
        { id: "a", startMin: 600, endMin: 660 },
        { id: "b", startMin: 630, endMin: 690 },
        { id: "c", startMin: 720, endMin: 780 },
      ],
      480,
    );
    const by = Object.fromEntries(placed.map((p) => [p.id, p]));
    assert.equal(by.a!.lanes, 2);
    assert.notEqual(by.a!.lane, by.b!.lane);
    assert.equal(by.c!.lanes, 1);
    assert.equal(by.a!.top, 120);
  });
});

describe("validación de la configuración del agente", () => {
  const valid = {
    systemPrompt: "Eres el asistente de {{negocio}} y ayudas a los clientes.",
    tone: "cálido",
    handoffMessage: "Te paso con una persona.",
    timezone: "America/Bogota",
    services: [{ name: "Corte", duration_minutes: 30 }],
    businessHours: { mon: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }] },
    businessInfo: [{ label: "Dirección", value: "Calle 1" }],
  };

  it("acepta una configuración correcta", () => {
    assert.equal(agentConfigSchema.safeParse(valid).success, true);
  });

  it("rechaza horarios invertidos o solapados, servicios repetidos y zonas inválidas", () => {
    const messageFor = (patch: object) => {
      const r = agentConfigSchema.safeParse({ ...valid, ...patch });
      return r.success ? null : describeIssue(r.error.issues[0]!);
    };
    assert.match(messageFor({ businessHours: { tue: [{ start: "18:00", end: "09:00" }] } })!, /martes.*posterior/i);
    assert.match(messageFor({ businessHours: { tue: [{ start: "09:00", end: "13:00" }, { start: "12:00", end: "15:00" }] } })!, /solapar/);
    assert.match(messageFor({ services: [{ name: "Corte", duration_minutes: 30 }, { name: "corte", duration_minutes: 20 }] })!, /Servicio 2.*mismo nombre/);
    assert.match(messageFor({ services: [{ name: "Corte", duration_minutes: 2 }] })!, /duración/);
    assert.match(messageFor({ timezone: "Marte/Olympus" })!, /Zona horaria/);
    assert.match(messageFor({ systemPrompt: "corto" })!, /Prompt/);
  });
});

describe("ventana de respuesta de WhatsApp", () => {
  it("solo permite responder durante las 24 h siguientes al último mensaje del cliente", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    assert.equal(replyWindowOpen("2026-10-30T11:00:00Z", now), true);
    assert.equal(replyWindowOpen("2026-10-29T12:00:01Z", now), true);
    assert.equal(replyWindowOpen("2026-10-29T11:59:59Z", now), false);
    assert.equal(replyWindowOpen(null, now), false);
  });
});

describe("tiempo real y panel contra Postgres", () => {
  const slug = `panel-${Date.now()}`;
  let orgA = "";
  let orgB = "";
  let conversationA = "";
  let conversationB = "";
  const listener = new RealtimeListener();

  const seedOrg = async (name: string) => {
    const [org] = await db.insert(schema.organizations).values({ name, slug: `${slug}-${name}`, timezone: "America/Mexico_City" }).returning();
    await db.insert(schema.agentConfigs).values({
      organizationId: org!.id,
      systemPrompt: "Eres el asistente de {{negocio}}.",
      services: [{ name: "Limpieza", duration_minutes: 45 }],
      businessHours: { mon: [{ start: "09:00", end: "18:00" }] },
    });
    const [contact] = await db.insert(schema.contacts).values({ organizationId: org!.id, waPhone: `+52${Date.now()}${name}`.slice(0, 15), fullName: `Cliente ${name}` }).returning();
    const [conversation] = await db.insert(schema.conversations).values({ organizationId: org!.id, contactId: contact!.id }).returning();
    return { org: org!, contact: contact!, conversation: conversation! };
  };

  const waitFor = async (predicate: () => boolean, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.fail("tiempo de espera agotado");
  };

  before(async () => {
    const a = await seedOrg("A");
    const b = await seedOrg("B");
    orgA = a.org.id;
    orgB = b.org.id;
    conversationA = a.conversation.id;
    conversationB = b.conversation.id;
  });

  after(async () => {
    await listener.close();
    await db.delete(schema.organizations).where(sql`${schema.organizations.slug} like ${`${slug}%`}`);
    await closePool();
  });

  it("entrega los eventos solo a los suscriptores de su organización", async () => {
    const forA: unknown[] = [];
    const forB: unknown[] = [];
    listener.subscribe(orgA, (e) => forA.push(e));
    listener.subscribe(orgB, (e) => forB.push(e));
    await new Promise((r) => setTimeout(r, 400)); // LISTEN activo

    await withTenant(orgA, (tx) =>
      tx.insert(schema.messages).values({ organizationId: orgA, conversationId: conversationA, direction: "inbound", sender: "contact", content: "hola A" }),
    );
    await waitFor(() => forA.length >= 1);
    assert.equal((forA[0] as { type: string }).type, "message.created");
    assert.equal((forA[0] as { conversationId: string }).conversationId, conversationA);
    assert.equal(forB.length, 0, "la organización B no recibe eventos de A");

    await withTenant(orgB, (tx) => tx.update(schema.conversations).set({ botActive: false }).where(eq(schema.conversations.id, conversationB)));
    await waitFor(() => forB.length >= 1);
    assert.equal((forB[0] as { type: string }).type, "conversation.updated");
    assert.ok(!forA.some((e) => (e as { conversationId?: string }).conversationId === conversationB));
  });

  it("notifica cambios de citas (trigger de la migración 0004)", async () => {
    const got: { type: string; id: string }[] = [];
    listener.subscribe(orgA, (e) => got.push(e as { type: string; id: string }));
    const [contact] = await withTenant(orgA, (tx) => tx.select().from(schema.contacts).limit(1));
    const start = new Date(Date.now() + 86_400_000);
    const [appt] = await withTenant(orgA, (tx) =>
      tx
        .insert(schema.appointments)
        .values({ organizationId: orgA, contactId: contact!.id, service: "Limpieza", startsAt: start, endsAt: new Date(start.getTime() + 45 * 60_000), fullName: "Ana", phone: "+521", status: "confirmed" })
        .returning(),
    );
    await waitFor(() => got.some((e) => e.type === "appointment.changed" && e.id === appt!.id));
    got.length = 0;
    await withTenant(orgA, (tx) => tx.update(schema.appointments).set({ status: "cancelled" }).where(eq(schema.appointments.id, appt!.id)));
    await waitFor(() => got.some((e) => e.type === "appointment.changed"));
  });

  it("se reconecta tras perder la conexión y avisa con resync", async () => {
    const got: { type: string }[] = [];
    listener.subscribe(orgA, (e) => got.push(e));
    await new Promise((r) => setTimeout(r, 300));
    // Mata la sesión que hace LISTEN (la única con esa consulta de espera en esta base).
    await db.execute(sql`
      select pg_terminate_backend(pid) from pg_stat_activity
      where pid <> pg_backend_pid() and datname = current_database() and usename = current_user and state = 'idle' and query like 'LISTEN%'`);
    await waitFor(() => got.some((e) => e.type === "resync"), 8000);
    // y vuelve a entregar eventos
    await withTenant(orgA, (tx) =>
      tx.insert(schema.messages).values({ organizationId: orgA, conversationId: conversationA, direction: "inbound", sender: "contact", content: "tras reconectar" }),
    );
    await waitFor(() => got.some((e) => e.type === "message.created"));
  });

  it("las consultas del panel solo ven la organización de la sesión", async () => {
    const listA = await listConversations(orgA);
    assert.deepEqual(listA.map((c) => c.id), [conversationA]);
    assert.equal(listA[0]!.preview, "tras reconectar");
    assert.equal((await listConversations(orgA, { filter: "attention" })).length, 0);
    assert.equal((await listConversations(orgB, { filter: "attention" })).length, 1);
    assert.equal((await listConversations(orgA, { query: "Cliente A" })).length, 1);
    assert.equal((await listConversations(orgA, { query: "Cliente B" })).length, 0);
    assert.equal((await listConversations(orgA, { query: "%" })).length, 0, "los comodines de LIKE se escapan");

    assert.equal(await getConversation(orgA, conversationB), null, "una conversación ajena es como una inexistente");
    assert.equal((await listMessages(orgA, conversationB)).messages.length, 0);
    const detail = await getConversation(orgA, conversationA);
    assert.ok(detail?.lastInboundAt);

    const page = await listMessages(orgA, conversationA, { limit: 1 });
    assert.equal(page.messages.length, 1);
    assert.equal(page.hasMore, true);
    assert.equal(page.messages[0]!.content, "tras reconectar");
    const older = await listMessages(orgA, conversationA, { before: page.messages[0]!.id, limit: 5 });
    assert.deepEqual(older.messages.map((m) => m.content), ["hola A"]);
    assert.equal(older.hasMore, false);

    const appts = await listAppointments(orgA, new Date(), new Date(Date.now() + 7 * 86_400_000));
    assert.equal(appts.length, 1);
    assert.equal(appts[0]!.status, "cancelled");
    assert.equal((await listAppointments(orgB, new Date(), new Date(Date.now() + 7 * 86_400_000))).length, 0);
  });

  it("el dashboard calcula indicadores reales", async () => {
    const data = await getDashboard(orgA, "America/Mexico_City");
    assert.equal(data.messagesToday.contact, 2);
    assert.equal(data.conversationsToday, 1);
    assert.equal(data.attentionCount, 0);
    assert.equal(data.upcomingCount, 0, "la única cita está cancelada");
    assert.equal(data.series.length, 14);
    assert.equal(data.series.at(-1)!.contact, 2);
    assert.equal(data.setup.whatsapp, false);
    assert.equal(data.setup.calendar, "missing");
    assert.equal(data.setup.services, true);
    assert.equal(data.setup.hours, true);
    const b = await getDashboard(orgB, "America/Mexico_City");
    assert.equal(b.attentionCount, 1);
    assert.equal(b.messagesToday.contact, 0);
  });

  it("«Probar agente» no tiene efectos: ni citas, ni mensajes, ni traspaso", async () => {
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    };
    const call = (toolName: string, input: unknown) => ({
      content: [{ type: "tool-call" as const, toolCallId: `c-${toolName}`, toolName, input: JSON.stringify(input) }],
      finishReason: { unified: "tool-calls" as const, raw: undefined },
      usage,
      warnings: [],
    });
    const say = (t: string) => ({ content: [{ type: "text" as const, text: t }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] });

    const monday = new Date("2099-01-05T15:00:00Z"); // lunes 09:00 en Ciudad de México
    const calendar = { freeBusy: async () => [], insertEvent: async () => assert.fail("no debe tocar Google"), deleteEvent: async () => assert.fail("no debe tocar Google") };
    let step = 0;
    let slot = "";
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        const prompt = JSON.stringify(options.prompt);
        if (step++ === 0) return call("check_availability", { service: "Limpieza", date_from: "2099-01-05", date_to: "2099-01-05" }) as never;
        if (step === 2) {
          slot = /"start_iso\\?":\\?"([^"\\]+)/.exec(prompt)?.[1] ?? "";
          return call("book_appointment", { service: "Limpieza", start_iso: slot, full_name: "Prueba Uno", is_new_patient: true }) as never;
        }
        if (step === 3) return call("handoff_to_human", { reason: "prueba" }) as never;
        return say("Listo (simulado)") as never;
      },
    });

    const before = await withTenant(orgA, async (tx) => ({
      appts: (await tx.select().from(schema.appointments)).length,
      msgs: (await tx.select().from(schema.messages)).length,
      bot: (await tx.select().from(schema.conversations).where(eq(schema.conversations.id, conversationA)))[0]!.botActive,
    }));
    const result = await runSandbox(orgA, [{ role: "user", content: "Quiero una limpieza el lunes" }], { model, calendar, now: () => monday });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.tools, ["check_availability", "book_appointment", "handoff_to_human"]);
    assert.equal(result.simulatedBooking, true);
    assert.equal(result.simulatedHandoff, true);
    assert.equal(result.text, "Listo (simulado)");
    assert.ok(slot.startsWith("2099-01-05T"), "reservó un horario que check_availability ofreció");

    const after = await withTenant(orgA, async (tx) => ({
      appts: (await tx.select().from(schema.appointments)).length,
      msgs: (await tx.select().from(schema.messages)).length,
      bot: (await tx.select().from(schema.conversations).where(eq(schema.conversations.id, conversationA)))[0]!.botActive,
    }));
    assert.deepEqual(after, before);
  });

  it("el sandbox rechaza horarios que no ofreció la agenda y exige API key sin modelo inyectado", async () => {
    const noKey = await runSandbox(orgA, [{ role: "user", content: "hola" }]);
    assert.equal(noKey.ok, false);
    if (!noKey.ok) assert.match(noKey.error, /ANTHROPIC_API_KEY/);
    const noUser = await runSandbox(orgA, [{ role: "assistant", content: "hola" }], { model: new MockLanguageModelV4({ doGenerate: async () => assert.fail("no debe llamar al modelo") }) });
    assert.equal(noUser.ok, false);
  });
});
