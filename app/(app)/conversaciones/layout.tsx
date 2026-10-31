import { ConversationsShell } from "@/components/conversations/conversations-shell";
import { PageHeader } from "@/components/ui/page";
import { listConversations } from "@/lib/panel/conversations";
import { requireSession } from "@/lib/session";

export default async function ConversationsLayout({ children }: { children: React.ReactNode }) {
  const { organizationId, organization } = await requireSession();
  const initial = await listConversations(organizationId);
  return (
    <>
      <PageHeader title="Conversaciones" description="Todos los chats con tus clientes, en tiempo real." />
      <ConversationsShell initial={initial} timeZone={organization.timezone}>
        {children}
      </ConversationsShell>
    </>
  );
}
