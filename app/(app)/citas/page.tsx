import type { Metadata } from "next";
import { CalendarBlank } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Citas" };

export default function Page() {
  return (
    <>
      <PageHeader title="Citas" description="Las citas agendadas por el agente y por tu equipo." />
      <EmptyState
        icon={<CalendarBlank size={20} />}
        title="Sin citas todavía"
        description="Las citas aparecerán aquí en cuanto el agente agende la primera."
      />
    </>
  );
}
