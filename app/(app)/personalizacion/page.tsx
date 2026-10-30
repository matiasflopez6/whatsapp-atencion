import type { Metadata } from "next";
import { GearSix } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Personalización" };

export default function Page() {
  return (
    <>
      <PageHeader title="Personalización" description="Prompt, tono, servicios y horarios del agente." />
      <EmptyState
        icon={<GearSix size={20} />}
        title="Configuración del agente"
        description="Aquí podrás editar el prompt, los servicios y los horarios sin tocar código."
      />
    </>
  );
}
