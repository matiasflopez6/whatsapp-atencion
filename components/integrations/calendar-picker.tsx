"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { ActionState } from "@/app/(app)/integraciones/actions";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  calendars: { id: string; name: string; primary: boolean }[];
  selected: string;
};

export function CalendarPicker({ action, calendars, selected }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <Field label="Calendario donde se agendan las citas" hint="Las citas nuevas se crean aquí y los horarios libres se calculan con este calendario.">
        <select
          name="calendarId"
          defaultValue={selected}
          className="h-9 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink"
        >
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}{c.primary ? " (principal)" : ""}
            </option>
          ))}
        </select>
      </Field>
      {state.error ? <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p> : null}
      {state.ok ? <p role="status" className="rounded-control bg-accent-soft px-3 py-2 text-sm text-accent-ink">{state.ok}</p> : null}
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Guardando…" : "Guardar calendario"}</Button>
    </form>
  );
}
