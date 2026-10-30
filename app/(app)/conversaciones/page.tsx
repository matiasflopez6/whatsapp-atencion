import type { Metadata } from "next";
import { ChatsCircle } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Conversaciones" };

export default function Page() {
  return (
    <>
      <PageHeader title="Conversaciones" description="Todos los chats con tus clientes, en tiempo real." />
      <EmptyState
        icon={<ChatsCircle size={20} />}
        title="Sin conversaciones todavía"
        description="Cuando un cliente escriba a tu número de WhatsApp, la conversación aparecerá aquí."
      />
    </>
  );
}
