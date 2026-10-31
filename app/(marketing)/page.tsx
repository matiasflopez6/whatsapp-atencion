import Link from "next/link";
import { CalendarCheck, ChatsCircle, UserSwitch } from "@phosphor-icons/react/dist/ssr";
import { Logo } from "@/components/logo";
import { buttonClass } from "@/components/ui/button";

const POINTS = [
  { icon: ChatsCircle, title: "Responde al instante", text: "Un agente de IA atiende a tus clientes por WhatsApp con la información de tu negocio." },
  { icon: CalendarCheck, title: "Agenda de verdad", text: "Propone horarios libres de tu Google Calendar y crea la cita sin que tengas que intervenir." },
  { icon: UserSwitch, title: "Tú tomas el control", text: "Apaga el bot en cualquier conversación y responde tú mismo desde el panel." },
];

export default function LandingPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4">
      <header className="flex h-16 items-center justify-between">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/login" className={buttonClass("ghost")}>
            Iniciar sesión
          </Link>
          <Link href="/signup" className={buttonClass("primary")}>
            Crear cuenta
          </Link>
        </nav>
      </header>
      <section className="py-20 md:py-28">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance md:text-5xl">
          Atención por WhatsApp que agenda citas por ti
        </h1>
        <p className="mt-4 max-w-xl text-lg text-ink-3">
          Conecta tu número de WhatsApp Business y tu Google Calendar. Tu agente responde, propone horarios reales y
          te pasa la conversación cuando hace falta.
        </p>
        <Link href="/signup" className={buttonClass("primary", "mt-8 h-11 px-5 text-base")}>
          Empezar ahora
        </Link>
      </section>
      <section className="grid gap-px overflow-hidden rounded-panel border border-line bg-line md:grid-cols-3">
        {POINTS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="bg-surface p-6">
            <Icon size={22} className="text-accent" />
            <h2 className="mt-3 font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-ink-3">{text}</p>
          </div>
        ))}
      </section>
      <footer className="mt-auto flex h-16 items-center justify-between text-sm text-ink-3">
        <span>Atención WhatsApp</span>
        <Link href="/privacidad" className="hover:text-ink">
          Política de privacidad
        </Link>
      </footer>
    </div>
  );
}
