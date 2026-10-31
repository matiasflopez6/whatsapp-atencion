import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, isStepCount, type LanguageModel, type ModelMessage } from "ai";
import { desc, eq } from "drizzle-orm";
import { agentConfigs, contacts, messages, organizations } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { withTenant } from "@/lib/db/tenant";
import { log } from "@/lib/logger";
import { ANTHROPIC_MODEL } from "./model";
import { buildSystemPrompt } from "./prompt";
import { createAgentTools, realCalendar, type AgentOutcome, type CalendarPort } from "./tools";

const HISTORY_LIMIT = 30;
const MAX_STEPS = 6;
const MAX_OUTPUT_TOKENS = 600;
const TIMEOUT_MS = 30_000;

export class AgentNotConfiguredError extends Error {
  constructor() {
    super("Falta ANTHROPIC_API_KEY en el servidor");
    this.name = "AgentNotConfiguredError";
  }
}

export type AgentDeps = { model?: LanguageModel; calendar?: CalendarPort; now?: () => Date };
export type AgentResult = { text: string; handoff: boolean; handoffReason?: string; booked: boolean };

function defaultModel(): LanguageModel {
  const apiKey = getEnv().ANTHROPIC_API_KEY;
  if (!apiKey) throw new AgentNotConfiguredError();
  return createAnthropic({ apiKey })(ANTHROPIC_MODEL);
}

/** Historial de la conversación → mensajes del modelo (empieza en `user`; roles consecutivos se fusionan). */
export function toModelMessages(rows: { direction: "inbound" | "outbound"; content: string | null }[]): ModelMessage[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const row of rows) {
    const text = row.content?.trim();
    if (!text) continue;
    const role = row.direction === "inbound" ? "user" : "assistant";
    const last = out[out.length - 1];
    if (last?.role === role) last.content += `\n${text}`;
    else out.push({ role, content: text });
  }
  while (out[0]?.role === "assistant") out.shift();
  return out;
}

/** Ejecuta el agente para el último mensaje de una conversación. Todo el acceso a datos va por withTenant. */
export async function runAgent(
  input: { organizationId: string; conversationId: string; contactId: string },
  deps: AgentDeps = {},
): Promise<AgentResult> {
  const { organizationId, conversationId, contactId } = input;
  const now = deps.now ?? (() => new Date());
  const model = deps.model ?? defaultModel();

  const { organization, config, contact, history } = await withTenant(organizationId, async (tx) => {
    const [organization] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    const [config] = await tx.select().from(agentConfigs).where(eq(agentConfigs.organizationId, organizationId)).limit(1);
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    const recent = await tx
      .select({ direction: messages.direction, content: messages.content, createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(HISTORY_LIMIT);
    return { organization, config, contact, history: recent.reverse() };
  });
  if (!organization || !config || !contact) throw new Error("Faltan datos de la organización, configuración o contacto");

  const outcome: AgentOutcome = { handoff: false, booked: false };
  const tools = createAgentTools({
    organizationId,
    organizationName: organization.name,
    conversationId,
    contact: { id: contact.id, waPhone: contact.waPhone, fullName: contact.fullName },
    config,
    timeZone: organization.timezone,
    now,
    calendar: deps.calendar ?? realCalendar,
    outcome,
  });

  const started = Date.now();
  const result = await generateText({
    model,
    system: buildSystemPrompt({
      config,
      organizationName: organization.name,
      timeZone: organization.timezone,
      now: now(),
      contact: { waPhone: contact.waPhone, fullName: contact.fullName },
    }),
    messages: toModelMessages(history),
    tools,
    stopWhen: isStepCount(MAX_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });

  log.info("agente respondió", {
    organizationId,
    conversationId,
    model: ANTHROPIC_MODEL,
    steps: result.steps.length,
    ms: Date.now() - started,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  });
  return { text: result.text.trim(), handoff: outcome.handoff, handoffReason: outcome.handoffReason, booked: outcome.booked };
}
