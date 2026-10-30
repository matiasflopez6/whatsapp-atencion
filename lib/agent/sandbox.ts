import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, isStepCount, type LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import { agentConfigs, organizations } from "@/db/schema";
import { withTenant } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import { formatLocal } from "@/lib/google/time";
import { ANTHROPIC_MODEL } from "./model";
import { buildSystemPrompt } from "./prompt";
import { toModelMessages } from "./run";
import { createAgentTools, realCalendar, type AgentOutcome, type CalendarPort } from "./tools";

/**
 * «Probar agente» de /personalizacion: el MISMO prompt, modelo y herramientas de lectura que en
 * producción (disponibilidad real de Google Calendar, información del negocio), pero sin efectos:
 * no se guarda ninguna conversación, no se envía nada por WhatsApp, no se crea ninguna cita y no se
 * apaga ningún bot. `book_appointment` y `handoff_to_human` se simulan.
 */
const MAX_STEPS = 6;
const MAX_OUTPUT_TOKENS = 600;
const TIMEOUT_MS = 30_000;
export const SANDBOX_MAX_MESSAGES = 20;
export const SANDBOX_MAX_CHARS = 1000;

export type SandboxTurn = { role: "user" | "assistant"; content: string };
export type SandboxResult =
  | { ok: true; text: string; tools: string[]; simulatedBooking: boolean; simulatedHandoff: boolean }
  | { ok: false; error: string };

export type SandboxDeps = { model?: LanguageModel; calendar?: CalendarPort; now?: () => Date };

export async function runSandbox(organizationId: string, history: SandboxTurn[], deps: SandboxDeps = {}): Promise<SandboxResult> {
  const apiKey = getEnv().ANTHROPIC_API_KEY;
  if (!deps.model && !apiKey) {
    return { ok: false, error: "Falta ANTHROPIC_API_KEY en el servidor: configúrala para poder probar al agente." };
  }
  const model = deps.model ?? createAnthropic({ apiKey })(ANTHROPIC_MODEL);
  const now = deps.now ?? (() => new Date());

  const { organization, config } = await withTenant(organizationId, async (tx) => {
    const [organization] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    const [config] = await tx.select().from(agentConfigs).where(eq(agentConfigs.organizationId, organizationId)).limit(1);
    return { organization, config };
  });
  if (!organization || !config) return { ok: false, error: "Falta la configuración del agente" };

  const messages = toModelMessages(history.map((t) => ({ direction: t.role === "user" ? "inbound" : "outbound", content: t.content })));
  if (messages[messages.length - 1]?.role !== "user") return { ok: false, error: "Escribe un mensaje para probar al agente" };

  const contact = { id: "sandbox", waPhone: "+10000000000", fullName: null };
  const outcome: AgentOutcome = { handoff: false, booked: false };
  const real = createAgentTools({
    organizationId,
    organizationName: organization.name,
    conversationId: "sandbox",
    contact,
    config,
    timeZone: organization.timezone,
    now,
    calendar: deps.calendar ?? realCalendar,
    outcome,
  });

  // Solo se puede «agendar» un horario que check_availability haya ofrecido en esta prueba.
  const offered = new Set<string>();
  type CheckInput = Parameters<NonNullable<typeof real.check_availability.execute>>;
  const tools = {
    ...real,
    check_availability: {
      ...real.check_availability,
      execute: async (...args: CheckInput) => {
        const result = await real.check_availability.execute!(...args);
        const slots = (result as { slots?: { start_iso: string }[] } | undefined)?.slots;
        for (const slot of slots ?? []) offered.add(slot.start_iso);
        return result;
      },
    },
    book_appointment: {
      ...real.book_appointment,
      execute: async (input: { service: string; start_iso: string }) => {
        if (!offered.has(input.start_iso)) {
          return { confirmed: false, error: "invalid_start", instruction: "Usa un start_iso devuelto por check_availability." };
        }
        outcome.booked = true;
        return {
          confirmed: true,
          simulated: true,
          service: input.service,
          when: formatLocal(new Date(input.start_iso), organization.timezone),
        };
      },
    },
    handoff_to_human: {
      ...real.handoff_to_human,
      execute: async () => {
        outcome.handoff = true;
        return { handed_off: true, simulated: true };
      },
    },
  };

  const result = await generateText({
    model,
    system: buildSystemPrompt({
      config,
      organizationName: organization.name,
      timeZone: organization.timezone,
      now: now(),
      contact: { waPhone: contact.waPhone, fullName: contact.fullName },
    }),
    messages,
    tools,
    stopWhen: isStepCount(MAX_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const used = result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName as string));
  return {
    ok: true,
    text: result.text.trim() || (outcome.handoff ? (config.handoffMessage ?? "") : ""),
    tools: used,
    simulatedBooking: outcome.booked,
    simulatedHandoff: outcome.handoff,
  };
}
