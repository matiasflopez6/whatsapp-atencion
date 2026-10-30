import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { LiveRefresh } from "@/components/dashboard/live-refresh";
import { MessagesChart } from "@/components/dashboard/messages-chart";
import { StatCard } from "@/components/dashboard/stat-card";
import { PageHeader, Panel } from "@/components/ui/page";
import { getEnv } from "@/lib/env";
import { getDashboard } from "@/lib/panel/dashboard";
import { clock, dayLabel, listTime } from "@/lib/panel/format";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const number = new Intl.NumberFormat("es");

function seconds(value: number | null): string {
  if (value === null) return "—";
  return value < 60 ? `${new Intl.NumberFormat("es", { maximumFractionDigits: 1 }).format(value)} s` : `${Math.round(value / 60)} min`;
}

export default async function Page() {
  const { organizationId, organization } = await requireSession();
  const tz = organization.timezone;
  const data = await getDashboard(organizationId, tz);
  const totalToday = data.messagesToday.contact + data.messagesToday.bot + data.messagesToday.human;

  const pending: { text: string; href: string; cta: string }[] = [];
  if (!data.setup.whatsapp) pending.push({ text: "Conecta tu número de WhatsApp Business para empezar a recibir mensajes.", href: "/integraciones", cta: "Conectar WhatsApp" });
  if (data.setup.calendar === "missing") pending.push({ text: "Conecta Google Calendar para que el agente ofrezca horarios reales.", href: "/integraciones", cta: "Conectar calendario" });
  if (data.setup.calendar === "disconnected") pending.push({ text: "Google Calendar se desconectó: el agente no puede ofrecer horarios.", href: "/integraciones", cta: "Reconectar" });
  if (!data.setup.services || !data.setup.hours) pending.push({ text: "Configura tus servicios y horarios de atención.", href: "/personalizacion", cta: "Personalizar agente" });
  const aiMissing = !getEnv().ANTHROPIC_API_KEY;

  return (
    <>
      <PageHeader title="Dashboard" description="Resumen de la actividad de tu negocio." actions={<LiveRefresh />} />

      {pending.length || aiMissing ? (
        <Panel className="divide-y divide-line border-warn/30">
          {pending.map((p) => (
            <div key={p.text} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <p className="flex items-center gap-2 text-ink-2">
                <WarningCircle size={16} className="text-warn" aria-hidden /> {p.text}
              </p>
              <Link href={p.href} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                {p.cta} <ArrowRight size={14} aria-hidden />
              </Link>
            </div>
          ))}
          {aiMissing ? (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-ink-2">
              <WarningCircle size={16} className="text-warn" aria-hidden /> El servidor aún no tiene credenciales de IA (<code>ANTHROPIC_API_KEY</code>): el agente no podrá responder.
            </p>
          ) : null}
        </Panel>
      ) : null}

      <section aria-label="Indicadores" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Conversaciones hoy"
          value={number.format(data.conversationsToday)}
          hint={`Ayer: ${number.format(data.conversationsYesterday)}`}
          href="/conversaciones"
        />
        <StatCard
          label="Mensajes hoy"
          value={number.format(totalToday)}
          hint={`${data.messagesToday.contact} de clientes · ${data.messagesToday.bot} del bot · ${data.messagesToday.human} del equipo`}
        />
        <StatCard label="Citas en los próximos 7 días" value={number.format(data.upcomingCount)} hint="Confirmadas" href="/citas" />
        <StatCard
          label="Requieren atención"
          value={number.format(data.attentionCount)}
          hint={data.attentionCount ? "Conversaciones con el bot apagado" : "Ninguna conversación pendiente"}
          href="/conversaciones"
          tone={data.attentionCount ? "warn" : "default"}
        />
      </section>

      <section aria-label="Rendimiento del agente" className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Citas agendadas este mes" value={number.format(data.bookedThisMonth)} hint="Sin contar canceladas" />
        <StatCard label="Respuesta del bot (mediana, 7 días)" value={seconds(data.botResponseSeconds)} hint="Desde que escribe el cliente hasta que responde" />
        <StatCard
          label="Sin intervención humana (30 días)"
          value={data.automatedRate === null ? "—" : `${data.automatedRate}%`}
          hint="Conversaciones que el bot llevó solo"
        />
      </section>

      <MessagesChart series={data.series} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Próximas citas</h2>
            <Link href="/citas" className="text-xs font-medium text-accent hover:underline">Ver calendario</Link>
          </div>
          {data.nextAppointments.length === 0 ? (
            <p className="flex items-center gap-2 py-8 text-sm text-ink-3"><CalendarCheck size={16} aria-hidden /> No hay citas próximas.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {data.nextAppointments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.fullName}</span>
                    <span className="block truncate text-xs text-ink-3 capitalize">{a.service}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-ink-2">
                    <span className="block first-letter:uppercase">{dayLabel(a.startsAt, tz)}</span>
                    <span className="block font-medium">{clock(a.startsAt, tz)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Conversaciones que requieren atención</h2>
            <Link href="/conversaciones" className="text-xs font-medium text-accent hover:underline">Ver todas</Link>
          </div>
          {data.attention.length === 0 ? (
            <p className="py-8 text-sm text-ink-3">El bot atiende todas las conversaciones.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {data.attention.map((c) => (
                <li key={c.id}>
                  <Link href={`/conversaciones/${c.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-accent">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-ink-3">{c.reason ?? "Bot apagado"}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-3">{listTime(c.lastMessageAt, tz)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
