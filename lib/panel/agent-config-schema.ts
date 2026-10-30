import { z } from "zod";
import type { BusinessHours } from "@/db/types";
import { isValidTimeZone, parseHHMM } from "@/lib/google/time";

export const DAYS = [
  { key: "mon", label: "Lunes" },
  { key: "tue", label: "Martes" },
  { key: "wed", label: "Miércoles" },
  { key: "thu", label: "Jueves" },
  { key: "fri", label: "Viernes" },
  { key: "sat", label: "Sábado" },
  { key: "sun", label: "Domingo" },
] as const satisfies readonly { key: keyof BusinessHours; label: string }[];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida (HH:MM)");

const range = z
  .object({ start: time, end: time })
  .refine((r) => (parseHHMM(r.start) ?? 0) < (parseHHMM(r.end) ?? 0), "La hora de cierre debe ser posterior a la de apertura");

const dayRanges = z.array(range).max(4, "Máximo 4 tramos por día").superRefine((ranges, ctx) => {
  const sorted = [...ranges].sort((a, b) => (parseHHMM(a.start) ?? 0) - (parseHHMM(b.start) ?? 0));
  for (let i = 1; i < sorted.length; i++) {
    if ((parseHHMM(sorted[i]!.start) ?? 0) < (parseHHMM(sorted[i - 1]!.end) ?? 0)) {
      ctx.addIssue({ code: "custom", message: "Los tramos del mismo día no pueden solaparse" });
      return;
    }
  }
});

const service = z.object({
  name: z.string().trim().min(1, "Indica el nombre").max(80, "Máximo 80 caracteres"),
  duration_minutes: z.number({ error: "Indica la duración" }).int("La duración debe ser un número entero").min(5, "Mínimo 5 minutos").max(480, "Máximo 480 minutos"),
  description: z.string().trim().max(300, "Máximo 300 caracteres").optional(),
});

const infoEntry = z.object({
  label: z.string().trim().min(1, "Indica el título").max(80, "Máximo 80 caracteres"),
  value: z.string().trim().min(1, "Escribe el contenido").max(2000, "Máximo 2000 caracteres"),
});

export const agentConfigSchema = z
  .object({
    systemPrompt: z.string().trim().min(20, "El prompt es demasiado corto (mínimo 20 caracteres)").max(8000, "El prompt es demasiado largo (máximo 8000 caracteres)"),
    tone: z.string().trim().min(2, "Indica el tono").max(200, "Máximo 200 caracteres"),
    handoffMessage: z.string().trim().min(2, "Escribe el mensaje de traspaso").max(500, "Máximo 500 caracteres"),
    timezone: z.string().refine(isValidTimeZone, "Zona horaria no válida"),
    services: z.array(service).max(50, "Máximo 50 servicios"),
    businessHours: z.object({
      mon: dayRanges.optional(),
      tue: dayRanges.optional(),
      wed: dayRanges.optional(),
      thu: dayRanges.optional(),
      fri: dayRanges.optional(),
      sat: dayRanges.optional(),
      sun: dayRanges.optional(),
    }),
    businessInfo: z.array(infoEntry).max(40, "Máximo 40 apartados"),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.services.forEach((s, i) => {
      const key = s.name.toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["services", i, "name"], message: "Hay dos servicios con el mismo nombre" });
      seen.add(key);
    });
    const labels = new Set<string>();
    value.businessInfo.forEach((e, i) => {
      const key = e.label.toLowerCase();
      if (labels.has(key)) ctx.addIssue({ code: "custom", path: ["businessInfo", i, "label"], message: "Hay dos apartados con el mismo título" });
      labels.add(key);
    });
  });

export type AgentConfigInput = z.infer<typeof agentConfigSchema>;

/** «Servicio 2 · Nombre: …», para mostrar el primer error con contexto. */
export function describeIssue(issue: { path: PropertyKey[]; message: string }): string {
  const [section, index, field] = issue.path;
  const n = typeof index === "number" ? index + 1 : null;
  switch (section) {
    case "services":
      return n ? `Servicio ${n}${field === "name" ? " · nombre" : field === "duration_minutes" ? " · duración" : ""}: ${issue.message}` : issue.message;
    case "businessInfo":
      return n ? `Información del negocio, apartado ${n}: ${issue.message}` : issue.message;
    case "businessHours": {
      const day = DAYS.find((d) => d.key === index)?.label;
      return day ? `Horario del ${day.toLowerCase()}: ${issue.message}` : issue.message;
    }
    case "systemPrompt":
      return `Prompt: ${issue.message}`;
    case "tone":
      return `Tono: ${issue.message}`;
    case "handoffMessage":
      return `Mensaje de traspaso: ${issue.message}`;
    case "timezone":
      return `Zona horaria: ${issue.message}`;
    default:
      return issue.message;
  }
}

/** businessInfo (jsonb libre) ↔ lista editable de apartados. Lo que no sea texto se muestra como JSON. */
export function infoToEntries(info: Record<string, unknown>): { label: string; value: string }[] {
  return Object.entries(info).map(([label, value]) => ({ label, value: typeof value === "string" ? value : JSON.stringify(value, null, 2) }));
}

export function entriesToInfo(entries: { label: string; value: string }[]): Record<string, string> {
  return Object.fromEntries(entries.map((e) => [e.label, e.value]));
}
