"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";

export type AuthFormState = { error?: string; fields?: Record<string, string> };

const loginSchema = z.object({
  email: z.email("Introduce un email válido"),
  password: z.string().min(1, "Introduce tu contraseña"),
});

const signupSchema = z.object({
  organizationName: z.string().trim().min(2, "Indica el nombre de tu negocio").max(80),
  name: z.string().trim().min(2, "Indica tu nombre").max(80),
  email: z.email("Introduce un email válido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(128),
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos";
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = Object.fromEntries(formData) as Record<string, string>;
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error), fields: { email: input.email ?? "" } };

  try {
    await auth.api.signInEmail({ body: parsed.data, headers: await headers() });
  } catch (error) {
    if (error instanceof APIError) return { error: "Email o contraseña incorrectos", fields: { email: parsed.data.email } };
    throw error;
  }
  redirect("/dashboard");
}

export async function signupAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = Object.fromEntries(formData) as Record<string, string>;
  const fields = { organizationName: input.organizationName ?? "", name: input.name ?? "", email: input.email ?? "" };
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error), fields };

  try {
    // `organizationName` no es un campo estándar de Better Auth: lo lee el hook user.create.after.
    await auth.api.signUpEmail({
      body: parsed.data as { name: string; email: string; password: string },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      const exists = /exist|already/i.test(String(error.message));
      return { error: exists ? "Ya existe una cuenta con ese email" : "No se pudo crear la cuenta", fields };
    }
    throw error;
  }
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
