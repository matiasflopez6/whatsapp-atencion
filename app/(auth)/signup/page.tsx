import type { Metadata } from "next";
import { SignupForm } from "@/components/auth-form";
import { signupAction } from "../actions";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Crea tu cuenta</h1>
      <p className="mb-5 text-sm text-ink-3">Configura tu negocio y conecta WhatsApp en unos minutos.</p>
      <SignupForm action={signupAction} />
    </>
  );
}
