import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ChatPanel } from "@/components/conversations/chat-panel";
import { getConversation, listMessages } from "@/lib/panel/conversations";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Conversación" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId, organization } = await requireSession();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  // withTenant: una conversación de otra organización es indistinguible de una inexistente.
  const conversation = await getConversation(organizationId, id);
  if (!conversation) notFound();
  const { messages, hasMore } = await listMessages(organizationId, id);

  return (
    <ChatPanel
      key={id}
      initialConversation={conversation}
      initialMessages={messages}
      initialHasMore={hasMore}
      timeZone={organization.timezone}
    />
  );
}
