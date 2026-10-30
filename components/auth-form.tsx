"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { AuthFormState } from "@/app/(auth)/actions";

type Action = (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;

export function LoginForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required defaultValue={state.fields?.email} />
      </Field>
      <Field label="Contraseña">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state.error ? (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </Button>
      <p className="text-center text-sm text-ink-3">
        ¿Aún no tienes cuenta?{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          Crear cuenta
        </Link>
      </p>
    </form>
  );
}

export function SignupForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      <Field label="Nombre del negocio" hint="Por ejemplo, el nombre de tu clínica.">
        <Input name="organizationName" required defaultValue={state.fields?.organizationName} />
      </Field>
      <Field label="Tu nombre">
        <Input name="name" autoComplete="name" required defaultValue={state.fields?.name} />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required defaultValue={state.fields?.email} />
      </Field>
      <Field label="Contraseña" hint="Mínimo 8 caracteres.">
        <Input name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      {state.error ? (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creando cuenta…" : "Crear cuenta"}
      </Button>
      <p className="text-center text-sm text-ink-3">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Iniciar sesión
        </Link>
      </p>
    </form>
  );
}
