"use client";

import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { ActionState } from "@/app/(app)/integraciones/actions";

type Props = {
  saveAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  testAction: () => Promise<ActionState>;
  connected: boolean;
  defaults: { phoneNumberId: string; wabaId: string };
};

function Notice({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>;
  if (state.ok) return <p role="status" className="rounded-control bg-accent-soft px-3 py-2 text-sm text-accent-ink">{state.ok}</p>;
  return null;
}

export function WhatsappForm({ saveAction, testAction, connected, defaults }: Props) {
  const [state, formAction, saving] = useActionState(saveAction, {});
  const [testState, runTest, testing] = useActionState<ActionState>(() => testAction(), {});
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone number ID">
            <Input name="phoneNumberId" inputMode="numeric" required defaultValue={state.fields?.phoneNumberId ?? defaults.phoneNumberId} />
          </Field>
          <Field label="WhatsApp Business Account ID">
            <Input name="wabaId" inputMode="numeric" required defaultValue={state.fields?.wabaId ?? defaults.wabaId} />
          </Field>
        </div>
        <Field label="Token de acceso (System User)" hint={connected ? "Déjalo vacío para conservar el guardado." : "Token permanente con permisos whatsapp_business_messaging y whatsapp_business_management."}>
          <Input name="accessToken" type="password" autoComplete="off" required={!connected} placeholder={connected ? "••••••••••••" : ""} />
        </Field>
        <Field label="App Secret de la app de Meta" hint={connected ? "Déjalo vacío para conservar el guardado." : "Se usa para validar la firma de cada mensaje que llega."}>
          <Input name="appSecret" type="password" autoComplete="off" required={!connected} placeholder={connected ? "••••••••••••" : ""} />
        </Field>
        <Notice state={state} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>{saving ? "Comprobando con Meta…" : connected ? "Guardar cambios" : "Conectar WhatsApp"}</Button>
          {connected ? (
            <Button type="button" variant="secondary" disabled={testing} onClick={() => startTransition(() => runTest())}>
              {testing ? "Probando…" : "Probar conexión"}
            </Button>
          ) : null}
        </div>
      </form>
      <Notice state={testState} />
    </div>
  );
}
