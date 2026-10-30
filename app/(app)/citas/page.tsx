import type { Metadata } from "next";
import { AppointmentsCalendar } from "@/components/appointments/appointments-calendar";
import { PageHeader } from "@/components/ui/page";
import { listAppointments } from "@/lib/panel/appointments";
import { todayIn, visibleRange } from "@/lib/panel/calendar-grid";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Citas" };

export default async function Page() {
  const { organizationId, organization } = await requireSession();
  const anchor = todayIn(organization.timezone);
  const { from, to } = visibleRange("month", anchor, organization.timezone);
  const initial = await listAppointments(organizationId, from, to);
  return (
    <>
      <PageHeader title="Citas" description="Las citas agendadas por el asistente, sincronizadas con Google Calendar." />
      <AppointmentsCalendar initial={initial} initialAnchor={anchor} timeZone={organization.timezone} />
    </>
  );
}
