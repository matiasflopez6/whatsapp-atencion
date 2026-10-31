/**
 * Flujo completo contra Postgres real (DATABASE_URL, migraciones aplicadas) con Meta, Google y el
 * modelo simulados: webhook → inbox → agente → herramientas → Calendar → respuesta → citas en BD.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
process.env.BETTER_AUTH_SECRET ??= "y".repeat(40);
process.env.GOOGLE_CLIENT_ID = "test-client";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";

const { and, eq } = await import("drizzle-orm");
const { db, closePool } = await import("@/lib/db");
const schema = await import("@/db/schema");
const { encrypt } = await import("@/lib/crypto");
const { withTenant } = await import("@/lib/db/tenant");
const { claimWebhookEventsForReprocess } = await import("@/lib/db/system");
const { signBody } = await import("@/lib/whatsapp/signature");
const { ingestWebhook } = await import("@/lib/whatsapp/ingest");
const { processWebhookEvent } = await import("@/lib/whatsapp/process");
const { zonedTimeToUtc } = await import("@/lib/google/time");

const TZ = "America/Mexico_City";
const APP_SECRET = "app-secret-de-prueba";
const PHONE_NUMBER_ID = `9${Date.now()}`;
const CUSTOMER = "5218112345678";
const slug = `test-${Date.now()}`;

let organizationId = "";
type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let outCounter = 0;
let busy: { start: string; end: string }[] = [];
const realFetch = globalThis.fetch;

function mockFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", body });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("https://graph.facebook.com/")) {
      if (body?.status === "read") return json({ success: true });
      return json({ messages: [{ id: `wamid.out.${++outCounter}` }] });
    }
    if (url.endsWith("/freeBusy")) return json({ calendars: { primary: { busy } } });
    if (url.includes("/calendars/primary/events")) return json({ id: "evt-123" });
    throw new Error(`fetch inesperado: ${url}`);
  }) as typeof fetch;
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const toolCall = (toolName: string, input: unknown) => ({
  content: [{ type: "tool-call" as const, toolCallId: `c-${toolName}-${Math.random()}`, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage,
  warnings: [],
});
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] });

/** Modelo guionado: cada llamada decide según el último mensaje de la conversación. */
function scripted(decide: (promptJson: string, n: number) => ReturnType<typeof text> | ReturnType<typeof toolCall>) {
  let n = 0;
  return new MockLanguageModelV4({ doGenerate: async (options) => decide(JSON.stringify(options.prompt), n++) as never });
}

function webhookBody(messageId: string, body: string) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, contacts: [{ wa_id: CUSTOMER, profile: { name: "Ana Pérez" } }], messages: [{ id: messageId, from: CUSTOMER, type: "text", text: { body } }] } }] }],
  });
}

async function receive(messageId: string, body: string) {
  const raw = webhookBody(messageId, body);
  const result = await ingestWebhook(raw, signBody(raw, APP_SECRET));
  assert.equal(result.status, 200);
  return result.status === 200 ? result.events : [];
}

const sentTexts = () => calls.filter((c) => c.url.endsWith(`/${PHONE_NUMBER_ID}/messages`) && (c.body as { text?: unknown })?.text).map((c) => (c.body as { text: { body: string } }).text.body);

describe("flujo WhatsApp → agente → Calendar", () => {
  before(async () => {
    mockFetch();
    const [org] = await db.insert(schema.organizations).values({ name: "Clínica Test", slug, timezone: TZ }).returning();
    organizationId = org!.id;
    const nextMonday = zonedTimeToUtc(new Date().getUTCFullYear() + 1, 3, 2, 12, 0, TZ); // fecha futura fija; el horario abarca todos los días
    void nextMonday;
    const allDay = [{ start: "09:00", end: "18:00" }];
    await db.insert(schema.agentConfigs).values({
      organizationId,
      systemPrompt: "Eres el asistente de {{negocio}}.",
      services: [{ name: "Limpieza dental", duration_minutes: 45 }],
      businessHours: { mon: allDay, tue: allDay, wed: allDay, thu: allDay, fri: allDay, sat: allDay, sun: allDay },
      businessInfo: { direccion: "Calle Falsa 123" },
      handoffMessage: "Te paso con una persona del equipo.",
    });
    await db.insert(schema.whatsappConfigs).values({
      organizationId, phoneNumberId: PHONE_NUMBER_ID, wabaId: "waba-1",
      accessTokenEncrypted: encrypt("wa-token"), verifyToken: `${slug}:tok`, appSecretEncrypted: encrypt(APP_SECRET),
    });
    await db.insert(schema.googleCalendarConfigs).values({
      organizationId, calendarId: "primary", refreshTokenEncrypted: encrypt("refresh"),
      accessTokenEncrypted: encrypt("access"), tokenExpiresAt: new Date(Date.now() + 3600_000),
    });
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
    await closePool();
  });

  it("rechaza firmas inválidas y deduplica por message.id", async () => {
    const raw = webhookBody("wamid.sig", "hola");
    assert.equal((await ingestWebhook(raw, "sha256=" + "0".repeat(64))).status, 401);
    assert.equal((await ingestWebhook(raw, null)).status, 401);
    const first = await receive("wamid.dup", "hola");
    const again = await receive("wamid.dup", "hola");
    assert.equal(first.length, 1);
    assert.equal(again.length, 0);
    // Deja el evento listo para el cron: debe ser reclamable pasada la gracia.
    await withTenant(organizationId, (tx) => tx.update(schema.webhookEvents).set({ receivedAt: new Date(Date.now() - 120_000) }).where(eq(schema.webhookEvents.id, first[0]!.id)));
    const claimed = await claimWebhookEventsForReprocess(10);
    assert.ok(claimed.some((c) => c.id === first[0]!.id));
    // Lo procesamos como lo haría el cron (sin respuesta del modelo real: usa mock que contesta).
    calls = [];
    await processWebhookEvent(first[0]!, { alreadyClaimed: true }, { model: scripted(() => text("¡Hola! ¿En qué te ayudo?")) });
    assert.deepEqual(sentTexts(), ["¡Hola! ¿En qué te ayudo?"]);
    const [ev] = await withTenant(organizationId, (tx) => tx.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, first[0]!.id)));
    assert.equal(ev?.status, "done");
  });

  it("propone horarios reales de FreeBusy y agenda la cita en Calendar y en la BD", async () => {
    calls = [];
    const model1 = scripted((prompt, n) => (n === 0 ? toolCall("check_availability", { service: "Limpieza dental", date_from: "2099-01-05", date_to: "2099-01-07" }) : text("Tengo estos horarios: ...")));
    const [e1] = await receive("wamid.q1", "Quiero una limpieza dental");
    await processWebhookEvent(e1!, {}, { model: model1, now: () => new Date("2099-01-04T12:00:00Z") });
    assert.ok(calls.some((c) => c.url.endsWith("/freeBusy")), "consultó FreeBusy");
    assert.ok(sentTexts().includes("Tengo estos horarios: ..."));

    // El modelo agenda con el start_iso que devolvió la herramienta (lo lee del historial de tool results).
    let startIso = "";
    const model2 = scripted((prompt, n) => {
      if (n === 0) return toolCall("check_availability", { service: "Limpieza dental", date_from: "2099-01-05", date_to: "2099-01-07" });
      if (n === 1) {
        startIso = /start_iso\\?":\\?"([^"\\]+)/.exec(prompt)?.[1] ?? "";
        return toolCall("book_appointment", { service: "Limpieza dental", start_iso: startIso, full_name: "Ana Pérez", is_new_patient: true });
      }
      return text("Listo, quedó agendada tu cita.");
    });
    calls = [];
    const [e2] = await receive("wamid.q2", "El primero. Soy Ana Pérez y es mi primera vez");
    await processWebhookEvent(e2!, {}, { model: model2, now: () => new Date("2099-01-04T12:00:00Z") });
    assert.ok(startIso, "se obtuvo un horario de la herramienta");
    assert.ok(calls.some((c) => c.url.includes("/calendars/primary/events") && c.method === "POST"), "creó el evento en Google");
    const [appt] = await withTenant(organizationId, (tx) => tx.select().from(schema.appointments));
    assert.equal(appt?.googleEventId, "evt-123");
    assert.equal(appt?.fullName, "Ana Pérez");
    assert.equal(appt?.startsAt.toISOString(), new Date(startIso).toISOString());
    assert.equal(appt?.phone, "+" + CUSTOMER);
    assert.ok(sentTexts().includes("Listo, quedó agendada tu cita."));
  });

  it("no agenda un horario ocupado ni inventado", async () => {
    calls = [];
    const startIso = zonedTimeToUtc(2099, 2, 10, 10, 0, TZ).toISOString();
    busy = [{ start: startIso, end: new Date(Date.parse(startIso) + 3600_000).toISOString() }];
    let bookResult = "";
    const model = scripted((prompt, n) => {
      if (n === 0) return toolCall("book_appointment", { service: "Limpieza dental", start_iso: startIso, full_name: "Ana Pérez", is_new_patient: false });
      bookResult = prompt;
      return text("Ese horario ya no está libre.");
    });
    const [e] = await receive("wamid.busy", "Quiero el 10 de febrero a las 10");
    await processWebhookEvent(e!, {}, { model, now: () => new Date("2099-01-04T12:00:00Z") });
    busy = [];
    assert.match(bookResult, /slot_taken/);
    assert.ok(!calls.some((c) => c.url.includes("/events") && c.method === "POST"), "no creó evento");
    const appts = await withTenant(organizationId, (tx) => tx.select().from(schema.appointments).where(eq(schema.appointments.startsAt, new Date(startIso))));
    assert.equal(appts.length, 0);
  });

  it("un reintento del mismo evento no duplica la respuesta", async () => {
    calls = [];
    const [e] = await receive("wamid.retry", "hola otra vez");
    await processWebhookEvent(e!, {}, { model: scripted(() => text("Respuesta única")) });
    assert.equal(sentTexts().length, 1);
    // Simula el cron reencolando un evento que ya se respondió (crash antes de marcar done).
    await withTenant(organizationId, (tx) => tx.update(schema.webhookEvents).set({ status: "pending" }).where(eq(schema.webhookEvents.id, e!.id)));
    await processWebhookEvent(e!, {}, { model: scripted(() => text("Respuesta duplicada")) });
    assert.equal(sentTexts().length, 1, "no se reenvía");
  });

  it("handoff apaga el bot, avisa y deja de responder", async () => {
    calls = [];
    const model = scripted((_p, n) => (n === 0 ? toolCall("handoff_to_human", { reason: "El cliente pide hablar con una persona" }) : text("")));
    const [e] = await receive("wamid.handoff", "Quiero hablar con una persona");
    await processWebhookEvent(e!, {}, { model });
    assert.deepEqual(sentTexts(), ["Te paso con una persona del equipo."]);
    const [conv] = await withTenant(organizationId, (tx) => tx.select().from(schema.conversations));
    assert.equal(conv?.botActive, false);
    assert.match(conv?.handoffReason ?? "", /persona/);

    calls = [];
    const [e2] = await receive("wamid.after", "¿sigues ahí?");
    await processWebhookEvent(e2!, {}, { model: scripted(() => text("NO DEBE ENVIARSE")) });
    assert.equal(sentTexts().length, 0);
    const msgs = await withTenant(organizationId, (tx) => tx.select().from(schema.messages).where(and(eq(schema.messages.direction, "inbound"), eq(schema.messages.waMessageId, "wamid.after"))));
    assert.equal(msgs.length, 1, "el mensaje entrante se guarda aunque el bot esté apagado");
  });

  it("si el agente falla en todos los intentos, pasa a humano", async () => {
    await withTenant(organizationId, (tx) => tx.update(schema.conversations).set({ botActive: true, handoffReason: null }));
    calls = [];
    const [e] = await receive("wamid.fail", "hola");
    await withTenant(organizationId, (tx) => tx.update(schema.webhookEvents).set({ attempts: 4 }).where(eq(schema.webhookEvents.id, e!.id)));
    const broken = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("Anthropic caído"); } });
    await processWebhookEvent(e!, {}, { model: broken });
    const [ev] = await withTenant(organizationId, (tx) => tx.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, e!.id)));
    assert.equal(ev?.status, "failed");
    assert.match(ev?.lastError ?? "", /caído/);
    assert.deepEqual(sentTexts(), ["Te paso con una persona del equipo."]);
  });
});
