/** DTOs serializables (fechas en ISO) que viajan entre servidor y cliente en el panel. */
export type Sender = "contact" | "bot" | "human";

export type ConversationSummary = {
  id: string;
  contactName: string | null;
  waPhone: string;
  botActive: boolean;
  /** Por qué el bot cedió la conversación (null si sigue activo o la apagó el dueño sin motivo). */
  handoffReason: string | null;
  lastMessageAt: string;
  preview: string | null;
  previewSender: Sender | null;
};

export type ConversationDetail = ConversationSummary & {
  /** Último mensaje del cliente: WhatsApp solo permite texto libre dentro de las 24 h siguientes. */
  lastInboundAt: string | null;
};

export type MessageDto = {
  id: string;
  direction: "inbound" | "outbound";
  sender: Sender;
  content: string | null;
  createdAt: string;
};

export type ConversationFilter = "all" | "attention" | "bot";

export type AppointmentStatus = "confirmed" | "cancelled" | "completed";

export type AppointmentDto = {
  id: string;
  service: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  fullName: string;
  phone: string;
  notes: string | null;
  isNewPatient: boolean | null;
  /** Hay un evento asociado en Google Calendar. */
  hasGoogleEvent: boolean;
  conversationId: string | null;
};
