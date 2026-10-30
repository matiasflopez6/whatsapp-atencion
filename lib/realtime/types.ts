/** Eventos de tiempo real. Viajan por Postgres NOTIFY y SSE solo con IDs: el cliente vuelve a leer los datos. */
export const REALTIME_EVENT_TYPES = ["message.created", "conversation.updated", "appointment.changed"] as const;
export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

export type RealtimeEvent = {
  type: RealtimeEventType;
  /** Fila afectada (mensaje, conversación o cita). */
  id: string;
  /** Presente en eventos de mensajes y conversaciones. */
  conversationId?: string;
};

/** Lo que recibe el cliente: eventos reales + `resync` cuando la conexión se restablece (pudo perderse algo). */
export type ClientRealtimeEvent = RealtimeEvent | { type: "resync" };
