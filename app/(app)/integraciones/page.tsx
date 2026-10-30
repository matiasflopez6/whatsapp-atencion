import type { Metadata } from "next";
import { CalendarCheck, WhatsappLogo } from "@phosphor-icons/react/dist/ssr";
import { eq } from "drizzle-orm";
import { googleCalendarConfigs, whatsappConfigs } from "@/db/schema";
import { CopyField } from "@/components/integrations/copy-field";
import { WhatsappForm } from "@/components/integrations/whatsapp-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/ui/page";
import { withTenant } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import { listCalendars, type CalendarSummary } from "@/lib/google/calendar";
import { googleCredentials } from "@/lib/google/oauth";
import { errorMessage } from "@/lib/logger";
import { requireSession } from "@/lib/session";
import { CalendarPicker } from "@/components/integrations/calendar-picker";
import { disconnectGoogleAction, disconnectWhatsappAction, saveCalendarAction, saveWhatsappAction, testWhatsappAction } from "./actions";

export const metadata: Metadata = { title: "Integraciones" };

const GOOGLE_MESSAGES: Record<string, { tone: "ok" | "error"; text: string }> = {
  connected: { tone: "ok", text: "Google Calendar conectado." },
  denied: { tone: "error", text: "No se concedió el acceso a Google Calendar." },
  invalid: { tone: "error", text: "La solicitud de Google no es válida o caducó. Inténtalo de nuevo." },
  no_refresh_token: { tone: "error", text: "Google no devolvió acceso permanente. Revoca el acceso de esta app en tu cuenta de Google y vuelve a conectar." },
  not_configured: { tone: "error", text: "El servidor no tiene configuradas las credenciales de Google." },
  error: { tone: "error", text: "No se pudo completar la conexión con Google. Inténtalo de nuevo." },
};

/** Navegación completa (no Link): la ruta redirige a accounts.google.com. */
function GoogleStart({ children }: { children: React.ReactNode }) {
  return (
    <form action="/api/auth/google/start" method="get">
      <Button type="submit">{children}</Button>
    </form>
  );
}

function Card({ icon, title, status, children }: { icon: React.ReactNode; title: string; status: React.ReactNode; children: React.ReactNode }) {
  return (
    <Panel className="space-y-5 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-accent-ink">{icon}</span>
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        {status}
      </div>
      {children}
    </Panel>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { organizationId } = await requireSession();
  const { google: googleResult } = await searchParams;

  const { whatsapp, calendar } = await withTenant(organizationId, async (tx) => {
    const [whatsapp] = await tx
      .select({
        phoneNumberId: whatsappConfigs.phoneNumberId,
        wabaId: whatsappConfigs.wabaId,
        verifyToken: whatsappConfigs.verifyToken,
      })
      .from(whatsappConfigs)
      .where(eq(whatsappConfigs.organizationId, organizationId))
      .limit(1);
    const [calendar] = await tx
      .select({
        calendarId: googleCalendarConfigs.calendarId,
        accountEmail: googleCalendarConfigs.accountEmail,
        status: googleCalendarConfigs.status,
        lastError: googleCalendarConfigs.lastError,
      })
      .from(googleCalendarConfigs)
      .where(eq(googleCalendarConfigs.organizationId, organizationId))
      .limit(1);
    return { whatsapp, calendar };
  });

  const googleConfigured = Boolean(googleCredentials());
  let calendars: CalendarSummary[] = [];
  let calendarsError: string | null = null;
  if (calendar?.status === "connected") {
    try {
      calendars = await listCalendars(organizationId);
    } catch (error) {
      calendarsError = errorMessage(error);
    }
  }
  const notice = googleResult ? GOOGLE_MESSAGES[googleResult] : undefined;
  const needsReconnect = calendar?.status === "disconnected";

  return (
    <>
      <PageHeader title="Integraciones" description="Conecta WhatsApp y Google Calendar para activar al agente." />

      <Card
        icon={<WhatsappLogo size={20} />}
        title="WhatsApp Business"
        status={<Badge tone={whatsapp ? "accent" : "neutral"}>{whatsapp ? "Conectado" : "Pendiente"}</Badge>}
      >
        <WhatsappForm
          saveAction={saveWhatsappAction}
          testAction={testWhatsappAction}
          connected={Boolean(whatsapp)}
          defaults={{ phoneNumberId: whatsapp?.phoneNumberId ?? "", wabaId: whatsapp?.wabaId ?? "" }}
        />
        {whatsapp ? (
          <div className="space-y-4 border-t border-line pt-5">
            <p className="text-sm text-ink-3">
              En Meta (WhatsApp → Configuración → Webhook) pega estos dos valores y suscribe el campo <strong>messages</strong>.
            </p>
            <CopyField label="URL de devolución de llamada" value={`${getEnv().appUrl}/api/webhooks/whatsapp`} />
            <CopyField label="Token de verificación" value={whatsapp.verifyToken} />
            <form action={disconnectWhatsappAction}>
              <Button variant="ghost" type="submit">Desconectar WhatsApp</Button>
            </form>
          </div>
        ) : null}
      </Card>

      <Card
        icon={<CalendarCheck size={20} />}
        title="Google Calendar"
        status={
          <Badge tone={needsReconnect ? "danger" : calendar ? "accent" : "neutral"}>
            {needsReconnect ? "Desconectado" : calendar ? "Conectado" : "Pendiente"}
          </Badge>
        }
      >
        {notice ? (
          <p role="status" className={`rounded-control px-3 py-2 text-sm ${notice.tone === "ok" ? "bg-accent-soft text-accent-ink" : "bg-danger-soft text-danger"}`}>
            {notice.text}
          </p>
        ) : null}
        {!googleConfigured ? (
          <p className="rounded-control bg-warn-soft px-3 py-2 text-sm text-warn">
            El servidor aún no tiene <code>GOOGLE_CLIENT_ID</code> y <code>GOOGLE_CLIENT_SECRET</code>. Hasta entonces no se puede conectar Google Calendar ni ofrecer horarios.
          </p>
        ) : null}

        {!calendar ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-3">El agente consulta tu disponibilidad real y crea las citas en el calendario que elijas.</p>
            {googleConfigured ? (
              <GoogleStart>Conectar con Google</GoogleStart>
            ) : null}
          </div>
        ) : needsReconnect ? (
          <div className="space-y-3">
            <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
              {calendar.lastError ?? "Google ya no permite el acceso."} Mientras tanto el agente no ofrecerá horarios.
            </p>
            {googleConfigured ? <GoogleStart>Reconectar con Google</GoogleStart> : null}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-3">Cuenta: <strong className="text-ink">{calendar.accountEmail}</strong></p>
            {calendarsError ? (
              <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">No se pudo leer tu lista de calendarios: {calendarsError}</p>
            ) : (
              <CalendarPicker action={saveCalendarAction} calendars={calendars} selected={calendar.calendarId} />
            )}
          </div>
        )}
        {calendar ? (
          <form action={disconnectGoogleAction} className="border-t border-line pt-4">
            <Button variant="ghost" type="submit">Desconectar Google Calendar</Button>
          </form>
        ) : null}
      </Card>
    </>
  );
}
