import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.BETTER_AUTH_SECRET ??= "x".repeat(40);
process.env.DATABASE_URL ??= "postgresql://x:x@localhost:5432/x";

const { verifySignature, signBody } = await import("@/lib/whatsapp/signature");
const { extractInbound, messageText, webhookPayloadSchema, toE164 } = await import("@/lib/whatsapp/payload");
const { computeSlots, pickSlots, withinBusinessHours } = await import("@/lib/google/availability");
const { zonedTimeToUtc, localParts } = await import("@/lib/google/time");
const { createState, readState } = await import("@/lib/google/oauth");
const { buildSystemPrompt } = await import("@/lib/agent/prompt");
const { toModelMessages } = await import("@/lib/agent/run");
const { withLock } = await import("@/lib/mutex");
const { encrypt, decrypt } = await import("@/lib/crypto");

const TZ = "America/Mexico_City"; // UTC-6 todo el año desde 2022
const HOURS = { mon: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "18:00" }], tue: [{ start: "09:00", end: "18:00" }] };

describe("firma HMAC", () => {
  it("acepta la firma correcta y rechaza alteraciones", () => {
    const body = JSON.stringify({ a: 1 });
    const sig = signBody(body, "secret");
    assert.equal(verifySignature(body, sig, "secret"), true);
    assert.equal(verifySignature(body + " ", sig, "secret"), false);
    assert.equal(verifySignature(body, sig, "otro"), false);
    assert.equal(verifySignature(body, null, "secret"), false);
    assert.equal(verifySignature(body, "sha256=zz", "secret"), false);
    assert.equal(verifySignature(body, "sha256=", "secret"), false);
  });
});

describe("payload de WhatsApp", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "111" },
              contacts: [{ wa_id: "5218112345678", profile: { name: "Ana" } }],
              messages: [
                { id: "wamid.1", from: "5218112345678", type: "text", text: { body: "Hola" } },
                { id: "wamid.2", from: "5218112345678", type: "audio" },
              ],
            },
          },
          { field: "messages", value: { metadata: { phone_number_id: "111" }, statuses: [{ id: "x" }] } },
        ],
      },
    ],
  };
  it("extrae mensajes, ignora statuses y normaliza", () => {
    const parsed = webhookPayloadSchema.parse(payload);
    const inbound = extractInbound(parsed);
    assert.equal(inbound.length, 2);
    assert.equal(inbound[0]?.contactName, "Ana");
    assert.equal(messageText(inbound[0]!.message), "Hola");
    assert.match(messageText(inbound[1]!.message), /audio/);
    assert.equal(toE164("5218112345678"), "+5218112345678");
  });
  it("rechaza payloads que no son de WhatsApp", () => {
    assert.equal(webhookPayloadSchema.safeParse({ foo: 1 }).success, false);
  });
});

describe("zonas horarias y disponibilidad", () => {
  it("convierte hora local a UTC", () => {
    assert.equal(zonedTimeToUtc(2026, 11, 2, 9, 0, TZ).toISOString(), "2026-11-02T15:00:00.000Z");
    assert.equal(localParts(new Date("2026-11-02T15:00:00Z"), TZ).hour, 9);
    // Madrid cambia de hora el 2026-10-25: 10:00 local = 09:00Z (CET) después, 08:00Z (CEST) antes.
    assert.equal(zonedTimeToUtc(2026, 10, 24, 10, 0, "Europe/Madrid").toISOString(), "2026-10-24T08:00:00.000Z");
    assert.equal(zonedTimeToUtc(2026, 10, 26, 10, 0, "Europe/Madrid").toISOString(), "2026-10-26T09:00:00.000Z");
  });

  // 2026-11-02 es lunes.
  const from = zonedTimeToUtc(2026, 11, 2, 0, 0, TZ);
  const to = zonedTimeToUtc(2026, 11, 4, 0, 0, TZ);
  const now = zonedTimeToUtc(2026, 11, 2, 8, 0, TZ);

  it("respeta horario, duración y eventos ocupados", () => {
    const busy = [{ start: zonedTimeToUtc(2026, 11, 2, 9, 30, TZ), end: zonedTimeToUtc(2026, 11, 2, 10, 30, TZ) }];
    const slots = computeSlots({ businessHours: HOURS, busy, durationMinutes: 60, timeZone: TZ, from, to, now });
    const labels = slots.map((s) => `${localParts(s.start, TZ).weekday} ${localParts(s.start, TZ).hour}:${String(localParts(s.start, TZ).minute).padStart(2, "0")}`);
    assert.ok(!labels.includes("mon 9:00"), "09:00-10:00 choca con el evento de 9:30");
    assert.ok(!labels.includes("mon 10:00"), "10:00-11:00 choca con el evento");
    assert.ok(labels.includes("mon 10:30"));
    assert.ok(labels.includes("mon 12:00"), "12-13 cabe antes del cierre del tramo");
    assert.ok(!labels.includes("mon 12:30"), "12:30-13:30 no cabe");
    assert.ok(!labels.includes("mon 13:00") && !labels.includes("mon 14:00"), "pausa de mediodía");
    assert.ok(labels.includes("mon 15:00") && labels.includes("tue 9:00"));
  });

  it("aplica el aviso mínimo y no ofrece días cerrados", () => {
    const slots = computeSlots({ businessHours: HOURS, busy: [], durationMinutes: 30, timeZone: TZ, from, to: zonedTimeToUtc(2026, 11, 9, 0, 0, TZ), now: zonedTimeToUtc(2026, 11, 2, 9, 0, TZ) });
    assert.ok(slots[0]!.start >= zonedTimeToUtc(2026, 11, 2, 10, 0, TZ), "mínimo 60 min de aviso");
    assert.ok(!slots.some((s) => ["wed", "thu", "fri", "sat", "sun"].includes(localParts(s.start, TZ).weekday)));
  });

  it("pickSlots reparte hasta 3 opciones", () => {
    const slots = computeSlots({ businessHours: HOURS, busy: [], durationMinutes: 30, timeZone: TZ, from, to, now });
    const picked = pickSlots(slots, 3, TZ);
    assert.equal(picked.length, 3);
    assert.ok(picked[1]!.start.getTime() - picked[0]!.start.getTime() >= 120 * 60_000 || localParts(picked[1]!.start, TZ).day !== localParts(picked[0]!.start, TZ).day);
  });

  it("withinBusinessHours rechaza lo que cruza el cierre", () => {
    const s = zonedTimeToUtc(2026, 11, 2, 12, 30, TZ);
    assert.equal(withinBusinessHours(s, new Date(s.getTime() + 30 * 60_000), HOURS, TZ), true);
    assert.equal(withinBusinessHours(s, new Date(s.getTime() + 60 * 60_000), HOURS, TZ), false);
  });
});

describe("OAuth state", () => {
  it("valida firma, nonce y caducidad", () => {
    const { state, nonce } = createState("org-1");
    assert.equal(readState(state, nonce), "org-1");
    assert.equal(readState(state, "otro-nonce"), null);
    assert.equal(readState(state, undefined), null);
    assert.equal(readState(state.slice(0, -1) + (state.endsWith("A") ? "B" : "A"), nonce), null);
    assert.equal(readState("basura", nonce), null);
  });
});

describe("agente: prompt e historial", () => {
  it("el prompt incluye siempre las reglas fijas y la config del negocio", () => {
    const prompt = buildSystemPrompt({
      config: { systemPrompt: "Eres el asistente de {{negocio}}.", tone: "cercano", services: [{ name: "Limpieza", duration_minutes: 45 }], businessHours: HOURS },
      organizationName: "Clínica X",
      timeZone: TZ,
      now: new Date("2026-11-02T15:00:00Z"),
      contact: { waPhone: "+5218112345678", fullName: null },
    });
    assert.match(prompt, /asistente de Clínica X/);
    assert.match(prompt, /Limpieza \(45 min\)/);
    assert.match(prompt, /lunes: 09:00–13:00, 15:00–18:00/);
    assert.match(prompt, /NUNCA ofrezcas/);
    assert.match(prompt, /confirmed: true/);
  });
  it("toModelMessages empieza en user y fusiona roles consecutivos", () => {
    const out = toModelMessages([
      { direction: "outbound", content: "Hola, soy el bot" },
      { direction: "inbound", content: "Hola" },
      { direction: "inbound", content: "quiero cita" },
      { direction: "outbound", content: "¿Qué servicio?" },
      { direction: "inbound", content: null },
    ]);
    assert.deepEqual(out, [
      { role: "user", content: "Hola\nquiero cita" },
      { role: "assistant", content: "¿Qué servicio?" },
    ]);
  });
});

describe("utilidades", () => {
  it("cifra y descifra (AES-256-GCM) y detecta manipulación", () => {
    const c = encrypt("token-secreto");
    assert.notEqual(c, "token-secreto");
    assert.equal(decrypt(c), "token-secreto");
    assert.throws(() => decrypt(c.slice(0, -2) + "AA"));
  });
  it("withLock serializa por clave", async () => {
    const order: string[] = [];
    await Promise.all([
      withLock("k", async () => { await new Promise((r) => setTimeout(r, 20)); order.push("a"); }),
      withLock("k", async () => { order.push("b"); }),
    ]);
    assert.deepEqual(order, ["a", "b"]);
  });
});
