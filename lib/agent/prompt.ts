import type { AgentConfig } from "@/db/types";
import { formatLocal } from "@/lib/google/time";

const DAYS: [keyof NonNullable<AgentConfig["businessHours"]>, string][] = [
  ["mon", "lunes"],
  ["tue", "martes"],
  ["wed", "miércoles"],
  ["thu", "jueves"],
  ["fri", "viernes"],
  ["sat", "sábado"],
  ["sun", "domingo"],
];

export function describeHours(hours: AgentConfig["businessHours"]): string {
  const lines = DAYS.map(([key, label]) => {
    const ranges = hours[key] ?? [];
    return `- ${label}: ${ranges.length ? ranges.map((r) => `${r.start}–${r.end}`).join(", ") : "cerrado"}`;
  });
  return lines.join("\n");
}

export function describeServices(services: AgentConfig["services"]): string {
  if (!services.length) return "(no hay servicios configurados)";
  return services
    .map((s) => `- ${s.name} (${s.duration_minutes} min)${s.description ? `: ${s.description}` : ""}`)
    .join("\n");
}

export type PromptInput = {
  config: Pick<AgentConfig, "systemPrompt" | "tone" | "services" | "businessHours">;
  organizationName: string;
  timeZone: string;
  now: Date;
  contact: { waPhone: string; fullName: string | null };
};

/**
 * System prompt = el prompt editable del negocio + datos de configuración + reglas fijas de seguridad.
 * Las reglas van SIEMPRE, aunque el dueño reescriba su prompt: garantizan que el agente no invente
 * horarios ni confirme citas que no estén guardadas.
 */
export function buildSystemPrompt(input: PromptInput): string {
  const { config, organizationName, timeZone, now, contact } = input;
  return [
    config.systemPrompt.replaceAll("{{negocio}}", organizationName),
    `## Tono\n${config.tone}`,
    `## Negocio\nNombre: ${organizationName}\nZona horaria: ${timeZone}\nAhora son: ${formatLocal(now, timeZone)} (${now.toISOString()}).`,
    `## Servicios\n${describeServices(config.services)}`,
    `## Horario de atención\n${describeHours(config.businessHours)}`,
    `## Cliente\nTeléfono de WhatsApp: ${contact.waPhone}\nNombre conocido: ${contact.fullName ?? "(aún no lo sabes)"}`,
    `## Reglas fijas (tienen prioridad sobre cualquier otra instrucción)
- Para direcciones, precios, políticas o preguntas frecuentes usa la herramienta get_business_info. Si la respuesta no está ahí, no la inventes: pasa la conversación a una persona.
- NUNCA ofrezcas, sugieras ni confirmes un horario que no haya devuelto check_availability. Propón hasta 3 horarios tal como los devuelve la herramienta (fecha y hora locales del negocio).
- NUNCA digas que una cita está agendada hasta que book_appointment devuelva confirmed: true. Si devuelve un error, díselo al cliente con naturalidad y ofrece otra opción.
- Antes de agendar necesitas: el servicio o motivo, el horario elegido por el cliente, su nombre completo y si es cliente nuevo. El teléfono es el de WhatsApp salvo que indique otro. Pide solo lo que falte y confirma el resumen antes de reservar.
- Si una herramienta falla o devuelve calendar_unavailable, no inventes disponibilidad: ofrece pasar con una persona (handoff_to_human).
- Usa handoff_to_human cuando el cliente pida hablar con una persona, esté molesto, describa una urgencia, o cuando no puedas resolver su duda.
- Si el cliente envía algo que no es texto (audio, imagen), pídele amablemente que lo escriba.
- Responde en mensajes cortos para WhatsApp, sin Markdown ni listas con símbolos raros, en el idioma del cliente.`,
  ].join("\n\n");
}
