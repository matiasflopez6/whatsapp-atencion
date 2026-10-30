"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { agentConfigs, organizations } from "@/db/schema";
import type { BusinessHours } from "@/db/types";
import { runSandbox, SANDBOX_MAX_CHARS, SANDBOX_MAX_MESSAGES, type SandboxResult } from "@/lib/agent/sandbox";
import { withTenant } from "@/lib/db/tenant";
import { errorMessage, log } from "@/lib/logger";
import { agentConfigSchema, describeIssue, entriesToInfo } from "@/lib/panel/agent-config-schema";
import { requireSession } from "@/lib/session";

export type SaveResult = { ok: true } | { ok: false; error: string };

/** Guarda la configuración del agente y la zona horaria del negocio. Entra en vigor en el siguiente mensaje. */
export async function saveAgentConfigAction(input: unknown): Promise<SaveResult> {
  const { organizationId } = await requireSession();
  const parsed = agentConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: describeIssue(parsed.error.issues[0]!) };
  const data = parsed.data;

  const businessHours: BusinessHours = {};
  for (const [day, ranges] of Object.entries(data.businessHours)) {
    if (ranges?.length) businessHours[day as keyof BusinessHours] = ranges;
  }

  try {
    await withTenant(organizationId, async (tx) => {
      await tx
        .update(agentConfigs)
        .set({
          systemPrompt: data.systemPrompt,
          tone: data.tone,
          handoffMessage: data.handoffMessage,
          services: data.services.map((s) => ({ name: s.name, duration_minutes: s.duration_minutes, ...(s.description ? { description: s.description } : {}) })),
          businessHours,
          businessInfo: entriesToInfo(data.businessInfo),
          updatedAt: new Date(),
        })
        .where(eq(agentConfigs.organizationId, organizationId));
      await tx.update(organizations).set({ timezone: data.timezone }).where(eq(organizations.id, organizationId));
    });
  } catch (error) {
    log.error("no se pudo guardar la configuración del agente", { organizationId, error: errorMessage(error) });
    return { ok: false, error: "No se pudo guardar. Inténtalo de nuevo." };
  }
  log.info("configuración del agente guardada", { organizationId });
  return { ok: true };
}

const historySchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(SANDBOX_MAX_CHARS) }))
  .min(1)
  .max(SANDBOX_MAX_MESSAGES);

// Límite por organización (en memoria): evita que una pestaña olvidada gaste la API sin control.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
const recent = new Map<string, number[]>();

function rateLimited(organizationId: string): boolean {
  const now = Date.now();
  const hits = (recent.get(organizationId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    recent.set(organizationId, hits);
    return true;
  }
  recent.set(organizationId, [...hits, now]);
  return false;
}

/** «Probar agente»: una vuelta del agente con la configuración GUARDADA y sin efectos (ver lib/agent/sandbox.ts). */
export async function testAgentAction(history: unknown): Promise<SandboxResult> {
  const { organizationId } = await requireSession();
  const parsed = historySchema.safeParse(history);
  if (!parsed.success) return { ok: false, error: `Mensaje no válido (máximo ${SANDBOX_MAX_CHARS} caracteres)` };
  if (rateLimited(organizationId)) return { ok: false, error: "Demasiadas pruebas seguidas. Espera un minuto." };
  try {
    return await runSandbox(organizationId, parsed.data);
  } catch (error) {
    log.error("falló la prueba del agente", { organizationId, error: errorMessage(error) });
    return { ok: false, error: "El agente no pudo responder. Revisa los logs o inténtalo de nuevo." };
  }
}
