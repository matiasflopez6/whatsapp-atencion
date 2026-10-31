/** WhatsApp solo permite texto libre durante las 24 h siguientes al último mensaje del cliente. */
export const REPLY_WINDOW_MS = 24 * 3600 * 1000;

export function replyWindowOpen(lastInboundAt: string | Date | null, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - new Date(lastInboundAt).getTime() < REPLY_WINDOW_MS;
}
