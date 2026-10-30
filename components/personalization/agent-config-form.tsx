"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CheckCircle, Plus, Trash, WarningCircle } from "@phosphor-icons/react";
import { saveAgentConfigAction } from "@/app/(app)/personalizacion/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Panel } from "@/components/ui/page";
import { DAYS } from "@/lib/panel/agent-config-schema";
import { cn } from "@/lib/utils";

type DayKey = (typeof DAYS)[number]["key"];
type Range = { start: string; end: string };
export type FormState = {
  systemPrompt: string;
  tone: string;
  handoffMessage: string;
  timezone: string;
  services: { name: string; duration: string; description: string }[];
  hours: Record<DayKey, Range[]>;
  info: { label: string; value: string }[];
};

const DEFAULT_RANGE: Range = { start: "09:00", end: "18:00" };
const INFO_SUGGESTIONS = ["Dirección", "Teléfono de contacto", "Precios", "Formas de pago", "Políticas de cancelación", "Preguntas frecuentes"];

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Panel className="space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-ink-3">{description}</p>
      </div>
      {children}
    </Panel>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return <p className="rounded-control bg-warn-soft px-3 py-2 text-sm text-warn">{children}</p>;
}

export function AgentConfigForm({ initial, timeZones, promptPreview }: { initial: FormState; timeZones: string[]; promptPreview: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);
  const patch = (changes: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...changes }));
    setJustSaved(false);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveAgentConfigAction({
        systemPrompt: form.systemPrompt,
        tone: form.tone,
        handoffMessage: form.handoffMessage,
        timezone: form.timezone,
        services: form.services.map((s) => ({
          name: s.name,
          duration_minutes: s.duration.trim() === "" ? undefined : Number(s.duration),
          description: s.description,
        })),
        businessHours: form.hours,
        businessInfo: form.info,
      });
      if (!result.ok) return setError(result.error);
      setSaved(form);
      setJustSaved(true);
      router.refresh(); // actualiza la vista previa del prompt
    });
  };

  const setRange = (day: DayKey, index: number, changes: Partial<Range>) =>
    patch({ hours: { ...form.hours, [day]: form.hours[day].map((r, i) => (i === index ? { ...r, ...changes } : r)) } });
  const noHours = DAYS.every((d) => form.hours[d.key].length === 0);
  const timeZoneOptions = timeZones.includes(form.timezone) ? timeZones : [form.timezone, ...timeZones];

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Section title="Personalidad del agente" description="Cómo se presenta y habla el asistente con tus clientes.">
        <Field label="Instrucciones (prompt)" hint="Usa {{negocio}} para insertar el nombre de tu negocio. Las reglas de seguridad (no inventar horarios ni confirmar citas sin guardarlas) se añaden siempre.">
          <Textarea rows={9} value={form.systemPrompt} onChange={(e) => patch({ systemPrompt: e.target.value })} maxLength={8000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tono" hint="Ej. profesional y cálido, cercano e informal.">
            <Input value={form.tone} onChange={(e) => patch({ tone: e.target.value })} maxLength={200} />
          </Field>
          <Field label="Zona horaria del negocio" hint="Define las horas que ve el agente y el calendario.">
            <Select value={form.timezone} onChange={(e) => patch({ timezone: e.target.value })}>
              {timeZoneOptions.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Mensaje al pasar con una persona" hint="Se envía al cliente cuando el agente le cede la conversación a tu equipo.">
          <Textarea rows={2} value={form.handoffMessage} onChange={(e) => patch({ handoffMessage: e.target.value })} maxLength={500} />
        </Field>
        <details className="rounded-control border border-line bg-canvas px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-ink-2">Ver el prompt completo que recibe el agente (configuración guardada)</summary>
          <pre className="mt-3 max-h-80 overflow-auto text-xs leading-relaxed whitespace-pre-wrap text-ink-2">{promptPreview}</pre>
        </details>
      </Section>

      <Section title="Servicios" description="Lo que ofreces y cuánto dura cada cita. El agente solo propone horarios con esta duración.">
        {form.services.length === 0 ? <Warning>Sin servicios, el agente usará citas de 30 minutos y no podrá validar el motivo de la cita.</Warning> : null}
        <ul className="space-y-3">
          {form.services.map((service, i) => (
            <li key={i} className="grid gap-3 rounded-control border border-line p-3 sm:grid-cols-[1fr_8rem_auto]">
              <Field label="Nombre">
                <Input
                  value={service.name}
                  maxLength={80}
                  onChange={(e) => patch({ services: form.services.map((s, j) => (j === i ? { ...s, name: e.target.value } : s)) })}
                />
              </Field>
              <Field label="Duración (min)">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={480}
                  step={5}
                  value={service.duration}
                  onChange={(e) => patch({ services: form.services.map((s, j) => (j === i ? { ...s, duration: e.target.value } : s)) })}
                />
              </Field>
              <div className="flex items-end">
                <Button
                  variant="ghost"
                  type="button"
                  aria-label={`Quitar servicio ${service.name || i + 1}`}
                  onClick={() => patch({ services: form.services.filter((_, j) => j !== i) })}
                >
                  <Trash size={16} />
                </Button>
              </div>
              <div className="sm:col-span-3">
                <Field label="Descripción (opcional)">
                  <Input
                    value={service.description}
                    maxLength={300}
                    onChange={(e) => patch({ services: form.services.map((s, j) => (j === i ? { ...s, description: e.target.value } : s)) })}
                  />
                </Field>
              </div>
            </li>
          ))}
        </ul>
        <Button variant="secondary" type="button" onClick={() => patch({ services: [...form.services, { name: "", duration: "30", description: "" }] })}>
          <Plus size={16} /> Añadir servicio
        </Button>
      </Section>

      <Section title="Horario de atención" description="Cuándo se pueden agendar citas. Se cruza con la disponibilidad real de Google Calendar.">
        {noHours ? <Warning>Sin horario configurado el agente no podrá ofrecer ningún horario.</Warning> : null}
        <ul className="divide-y divide-line">
          {DAYS.map(({ key, label }) => {
            const ranges = form.hours[key];
            const open = ranges.length > 0;
            return (
              <li key={key} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
                <label className="flex w-32 items-center gap-2 pt-1.5 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={open}
                    onChange={(e) => patch({ hours: { ...form.hours, [key]: e.target.checked ? [{ ...DEFAULT_RANGE }] : [] } })}
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  {label}
                </label>
                {open ? (
                  <div className="space-y-2">
                    {ranges.map((range, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input type="time" aria-label={`${label}: apertura`} value={range.start} onChange={(e) => setRange(key, i, { start: e.target.value })} className="w-28" />
                        <span className="text-ink-3">a</span>
                        <Input type="time" aria-label={`${label}: cierre`} value={range.end} onChange={(e) => setRange(key, i, { end: e.target.value })} className="w-28" />
                        <Button
                          variant="ghost"
                          type="button"
                          aria-label={`Quitar tramo del ${label.toLowerCase()}`}
                          onClick={() => patch({ hours: { ...form.hours, [key]: ranges.filter((_, j) => j !== i) } })}
                        >
                          <Trash size={16} />
                        </Button>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-3">
                      {ranges.length < 4 ? (
                        <button
                          type="button"
                          className="text-xs font-medium text-accent hover:underline"
                          onClick={() => patch({ hours: { ...form.hours, [key]: [...ranges, { start: "16:00", end: "20:00" }] } })}
                        >
                          + Añadir tramo (p. ej. turno de tarde)
                        </button>
                      ) : null}
                      {key === "mon" ? (
                        <button
                          type="button"
                          className="text-xs font-medium text-accent hover:underline"
                          onClick={() => patch({ hours: { ...form.hours, tue: ranges.map((r) => ({ ...r })), wed: ranges.map((r) => ({ ...r })), thu: ranges.map((r) => ({ ...r })), fri: ranges.map((r) => ({ ...r })) } })}
                        >
                          Copiar a martes–viernes
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <span className="pt-1.5 text-sm text-ink-4">Cerrado</span>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        title="Información del negocio"
        description="Datos que el agente consulta antes de responder: dirección, precios, políticas, preguntas frecuentes… Si algo no está aquí, no lo inventa."
      >
        <ul className="space-y-3">
          {form.info.map((entry, i) => (
            <li key={i} className="space-y-2 rounded-control border border-line p-3">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Field label="Título">
                    <Input
                      list="info-suggestions"
                      value={entry.label}
                      maxLength={80}
                      onChange={(e) => patch({ info: form.info.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                    />
                  </Field>
                </div>
                <Button variant="ghost" type="button" aria-label={`Quitar ${entry.label || `apartado ${i + 1}`}`} onClick={() => patch({ info: form.info.filter((_, j) => j !== i) })}>
                  <Trash size={16} />
                </Button>
              </div>
              <Field label="Contenido">
                <Textarea
                  rows={3}
                  value={entry.value}
                  maxLength={2000}
                  onChange={(e) => patch({ info: form.info.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                />
              </Field>
            </li>
          ))}
        </ul>
        <datalist id="info-suggestions">
          {INFO_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Button variant="secondary" type="button" onClick={() => patch({ info: [...form.info, { label: "", value: "" }] })}>
          <Plus size={16} /> Añadir apartado
        </Button>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-surface/95 px-4 py-3 shadow-sm backdrop-blur">
        <p role="status" className={cn("flex items-center gap-2 text-sm", error ? "text-danger" : justSaved ? "text-accent-ink" : "text-ink-3")}>
          {error ? (
            <>
              <WarningCircle size={16} aria-hidden /> {error}
            </>
          ) : justSaved ? (
            <>
              <CheckCircle size={16} weight="fill" aria-hidden /> Cambios guardados. El agente los usará desde su próximo mensaje.
            </>
          ) : dirty ? (
            "Tienes cambios sin guardar."
          ) : (
            "Todo guardado."
          )}
        </p>
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
