import type { Metadata } from "next";
import { House } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Dashboard" };

export default function Page() {
  return (
    <>
      <PageHeader title="Dashboard" description="Resumen de la actividad de tu negocio." />
      <EmptyState
        icon={<House size={20} />}
        title="Aún no hay actividad"
        description="Cuando conectes WhatsApp y empieces a recibir mensajes, aquí verás tus conversaciones y citas."
      />
    </>
  );
}
