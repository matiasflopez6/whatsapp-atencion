import { and, asc, eq, gte, sql } from "drizzle-orm";
import { agentConfigs, appointments, contacts, conversations, googleCalendarConfigs, whatsappConfigs } from "@/db/schema";
import { withTenant } from "@/lib/db/tenant";
import { addDays, civilKey, todayIn, type CivilDate } from "./calendar-grid";

export const SERIES_DAYS = 14;

export type DaySeries = { key: string; contact: number; bot: number; human: number };

export type DashboardData = {
  conversationsToday: number;
  conversationsYesterday: number;
  messagesToday: { contact: number; bot: number; human: number };
  upcomingCount: number;
  bookedThisMonth: number;
  attentionCount: number;
  /** Mediana en segundos entre el mensaje del cliente y la respuesta del bot (últimos 7 días); null sin datos. */
  botResponseSeconds: number | null;
  /** % de conversaciones activas en 30 días sin traspaso ni mensajes humanos; null sin conversaciones. */
  automatedRate: number | null;
  series: DaySeries[];
  nextAppointments: { id: string; service: string; fullName: string; startsAt: string }[];
  attention: { id: string; name: string; reason: string | null; lastMessageAt: string }[];
  setup: { whatsapp: boolean; calendar: "connected" | "disconnected" | "missing"; services: boolean; hours: boolean };
};

type Rows<T> = { rows: T[] };

export async function getDashboard(organizationId: string, timeZone: string, now: Date = new Date()): Promise<DashboardData> {
  const today = todayIn(timeZone, now);
  const firstDay = addDays(today, -(SERIES_DAYS - 1));
  const sevenDays = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

  return withTenant(organizationId, async (tx) => {
    const localDay = (column: string) => sql.raw(`(${column} at time zone '${timeZone.replace(/'/g, "''")}')::date`);
    // `timeZone` se valida con Intl al guardarse; aun así se escapa al incrustarlo (AT TIME ZONE no admite parámetros en todos los casos).
    const todayExpr = sql`(${now.toISOString()}::timestamptz at time zone ${timeZone})::date`;

    const [counts] = (await tx.execute(sql`
      select
        count(distinct m.conversation_id) filter (where ${localDay("m.created_at")} = ${todayExpr})::int as conversations_today,
        count(distinct m.conversation_id) filter (where ${localDay("m.created_at")} = ${todayExpr} - 1)::int as conversations_yesterday,
        count(*) filter (where ${localDay("m.created_at")} = ${todayExpr} and m.sender = 'contact')::int as contact_today,
        count(*) filter (where ${localDay("m.created_at")} = ${todayExpr} and m.sender = 'bot')::int as bot_today,
        count(*) filter (where ${localDay("m.created_at")} = ${todayExpr} and m.sender = 'human')::int as human_today
      from messages m
      where m.created_at >= ${new Date(now.getTime() - 3 * 24 * 3600 * 1000).toISOString()}::timestamptz
    `) as Rows<Record<string, number>>).rows;

    const seriesRows = (await tx.execute(sql`
      select to_char(${localDay("m.created_at")}, 'YYYY-MM-DD') as day, m.sender, count(*)::int as n
      from messages m
      where m.created_at >= ${new Date(now.getTime() - (SERIES_DAYS + 1) * 24 * 3600 * 1000).toISOString()}::timestamptz
      group by 1, 2
    `)) as Rows<{ day: string; sender: "contact" | "bot" | "human"; n: number }>;

    const [response] = (await tx.execute(sql`
      select percentile_cont(0.5) within group (order by extract(epoch from (o.created_at - i.created_at)))::float as seconds
      from messages o
      join messages i on i.id = (o.raw->>'inReplyTo')::uuid
      where o.sender = 'bot' and o.created_at >= ${new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString()}::timestamptz
    `) as Rows<{ seconds: number | null }>).rows;

    const [automation] = (await tx.execute(sql`
      select
        count(*)::int as total,
        count(*) filter (
          where c.handoff_reason is null and c.bot_active
            and not exists (select 1 from messages h where h.conversation_id = c.id and h.sender = 'human')
        )::int as automated
      from conversations c
      where c.last_message_at >= ${new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()}::timestamptz
    `) as Rows<{ total: number; automated: number }>).rows;

    const [month] = (await tx.execute(sql`
      select count(*)::int as n from appointments a
      where date_trunc('month', a.created_at at time zone ${timeZone}) = date_trunc('month', ${now.toISOString()}::timestamptz at time zone ${timeZone})
        and a.status <> 'cancelled'
    `) as Rows<{ n: number }>).rows;

    const [upcoming] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(appointments)
      .where(and(eq(appointments.status, "confirmed"), gte(appointments.startsAt, now), sql`${appointments.startsAt} < ${sevenDays.toISOString()}::timestamptz`));

    const nextAppointments = await tx
      .select({ id: appointments.id, service: appointments.service, fullName: appointments.fullName, startsAt: appointments.startsAt })
      .from(appointments)
      .where(and(eq(appointments.status, "confirmed"), gte(appointments.startsAt, now)))
      .orderBy(asc(appointments.startsAt))
      .limit(5);

    const [attentionTotal] = await tx.select({ n: sql<number>`count(*)::int` }).from(conversations).where(eq(conversations.botActive, false));
    const attention = await tx
      .select({ id: conversations.id, name: contacts.fullName, phone: contacts.waPhone, reason: conversations.handoffReason, lastMessageAt: conversations.lastMessageAt })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(eq(conversations.botActive, false))
      .orderBy(sql`${conversations.lastMessageAt} desc`)
      .limit(5);

    const [whatsapp] = await tx.select({ id: whatsappConfigs.organizationId }).from(whatsappConfigs).limit(1);
    const [calendar] = await tx.select({ status: googleCalendarConfigs.status }).from(googleCalendarConfigs).limit(1);
    const [config] = await tx.select({ services: agentConfigs.services, hours: agentConfigs.businessHours }).from(agentConfigs).limit(1);

    const byDay = new Map<string, DaySeries>();
    const days: CivilDate[] = Array.from({ length: SERIES_DAYS }, (_, i) => addDays(firstDay, i));
    for (const d of days) byDay.set(civilKey(d), { key: civilKey(d), contact: 0, bot: 0, human: 0 });
    for (const row of seriesRows.rows) {
      const entry = byDay.get(row.day);
      if (entry) entry[row.sender] = row.n;
    }

    const total = automation?.total ?? 0;
    return {
      conversationsToday: counts?.conversations_today ?? 0,
      conversationsYesterday: counts?.conversations_yesterday ?? 0,
      messagesToday: { contact: counts?.contact_today ?? 0, bot: counts?.bot_today ?? 0, human: counts?.human_today ?? 0 },
      upcomingCount: upcoming?.n ?? 0,
      bookedThisMonth: month?.n ?? 0,
      attentionCount: attentionTotal?.n ?? 0,
      botResponseSeconds: response?.seconds ?? null,
      automatedRate: total > 0 ? Math.round(((automation?.automated ?? 0) / total) * 100) : null,
      series: days.map((d) => byDay.get(civilKey(d))!),
      nextAppointments: nextAppointments.map((a) => ({ ...a, startsAt: a.startsAt.toISOString() })),
      attention: attention.map((c) => ({
        id: c.id,
        name: c.name ?? c.phone,
        reason: c.reason,
        lastMessageAt: (c.lastMessageAt ?? new Date(0)).toISOString(),
      })),
      setup: {
        whatsapp: Boolean(whatsapp),
        calendar: calendar ? calendar.status : "missing",
        services: (config?.services.length ?? 0) > 0,
        hours: Object.values(config?.hours ?? {}).some((ranges) => (ranges?.length ?? 0) > 0),
      },
    };
  });
}
