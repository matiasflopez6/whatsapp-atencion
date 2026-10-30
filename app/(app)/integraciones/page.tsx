import type { Metadata } from "next";
import { PlugsConnected } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Integraciones" };

export default function Page() {
  return (
    <>
      <PageHeader title="Integraciones" description="Conecta WhatsApp y Google Calendar." />
      <EmptyState
        icon={<PlugsConnected size={20} />}
        title="Nada conectado todavía"
        description="Conecta tu número de WhatsApp Business y tu Google Calendar para activar al agente."
      />
    </>
  );
}
