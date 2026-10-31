import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Política de privacidad",
  description: "Qué datos trata Atención WhatsApp, para qué se usan y con quién se comparten.",
};

const UPDATED = "31 de octubre de 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-2 text-ink-2">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-4 pb-16">
      <header className="flex h-16 items-center justify-between">
        <Link href="/" aria-label="Inicio">
          <Logo />
        </Link>
        <Link href="/login" className={buttonClass("ghost")}>
          Iniciar sesión
        </Link>
      </header>

      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Política de privacidad</h1>
      <p className="mt-2 text-sm text-ink-3">Última actualización: {UPDATED}</p>

      <Section title="Qué es este servicio">
        <p>
          Atención WhatsApp es una plataforma para negocios que trabajan con citas. Un agente de inteligencia artificial
          responde por WhatsApp a los clientes del negocio, consulta la disponibilidad real en Google Calendar, agenda
          citas y pasa la conversación a una persona cuando hace falta. El negocio que contrata el servicio es el
          responsable de los datos de sus clientes; esta plataforma los trata por su cuenta y siguiendo sus instrucciones.
        </p>
      </Section>

      <Section title="Datos que tratamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Cuenta del negocio:</strong> nombre, correo electrónico, contraseña (almacenada solo como hash) y
            datos de configuración del negocio (servicios, horarios, tono del agente).
          </li>
          <li>
            <strong>Conversaciones de WhatsApp:</strong> número de teléfono y nombre de perfil del cliente, y el
            contenido y la fecha de los mensajes que recibe o envía el negocio.
          </li>
          <li>
            <strong>Citas:</strong> servicio, fecha, hora, estado y datos de contacto que el cliente facilita para
            agendar.
          </li>
          <li>
            <strong>Credenciales de integraciones:</strong> los tokens de WhatsApp Business y de Google del negocio. Se
            guardan cifrados (AES-256-GCM) y nunca se muestran en claro.
          </li>
        </ul>
      </Section>

      <Section title="Uso de los datos de Google">
        <p>
          Si el negocio conecta su Google Calendar, la plataforma solicita el permiso{" "}
          <code className="rounded bg-subtle px-1 text-sm">https://www.googleapis.com/auth/calendar</code> y lo usa
          únicamente para consultar la disponibilidad del calendario elegido, crear las citas que agenda el agente y
          actualizarlas o cancelarlas cuando cambia su estado. No se usa para publicidad, no se vende ni se comparte con
          terceros, y no se leen eventos con fines distintos a los anteriores.
        </p>
        <p>
          El uso y la transferencia a cualquier otra aplicación de la información recibida de las API de Google se
          ajustará a la{" "}
          <a
            className="text-accent underline underline-offset-2"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
          >
            Política de datos de usuario de los servicios de API de Google
          </a>
          , incluidos los requisitos de uso limitado.
        </p>
        <p>
          El negocio puede desconectar Google Calendar en cualquier momento desde el panel y revocar el acceso desde su
          cuenta de Google.
        </p>
      </Section>

      <Section title="Con quién se comparten">
        <p>Solo con los proveedores necesarios para prestar el servicio, que actúan como encargados del tratamiento:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Meta (WhatsApp Business Platform), para recibir y enviar mensajes.</li>
          <li>Anthropic, cuyo modelo de IA recibe el contenido necesario de la conversación para redactar las respuestas.</li>
          <li>Google, para la consulta y gestión del calendario descrita arriba.</li>
          <li>Railway, que aloja la aplicación y su base de datos.</li>
        </ul>
        <p>No vendemos datos personales.</p>
      </Section>

      <Section title="Conservación y seguridad">
        <p>
          Los datos se conservan mientras la cuenta del negocio esté activa o hasta que el negocio pida su eliminación.
          Cada negocio solo accede a sus propios datos: el aislamiento entre negocios se aplica también en la base de
          datos. Las comunicaciones viajan cifradas (HTTPS) y los secretos de terceros se almacenan cifrados.
        </p>
      </Section>

      <Section title="Tus derechos">
        <p>
          Puedes pedir acceso, rectificación o eliminación de tus datos. Si eres cliente final de un negocio, dirígete a
          ese negocio; si eres titular de una cuenta, puedes solicitarlo al operador del servicio por el medio de
          contacto indicado al contratarlo. Cuando se solicite la eliminación, se borrarán los datos asociados, incluidos
          los tokens de las integraciones.
        </p>
      </Section>

      <Section title="Cambios">
        <p>Si esta política cambia, se actualizará la fecha de esta página.</p>
      </Section>
    </div>
  );
}
