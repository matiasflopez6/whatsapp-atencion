import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-form";
import { loginAction } from "../actions";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Iniciar sesión</h1>
      <p className="mb-5 text-sm text-ink-3">Accede al panel de tu negocio.</p>
      <LoginForm action={loginAction} />
    </>
  );
}
