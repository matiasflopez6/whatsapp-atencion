"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, PaperPlaneRight, Robot, User, WarningCircle } from "@phosphor-icons/react";
import { sendHumanMessageAction, setBotActiveAction } from "@/app/(app)/conversaciones/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clock, dayKey, dayLabel, initials } from "@/lib/panel/format";
import { replyWindowOpen } from "@/lib/panel/reply-window";
import type { ConversationDetail, MessageDto } from "@/lib/panel/types";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { cn } from "@/lib/utils";

type Props = {
  initialConversation: ConversationDetail;
  initialMessages: MessageDto[];
  initialHasMore: boolean;
  timeZone: string;
};

const SENDER_LABEL = { contact: "Cliente", bot: "Bot", human: "Equipo" } as const;
const MAX_LENGTH = 4096;

function merge(current: MessageDto[], incoming: MessageDto[]): MessageDto[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function ChatPanel({ initialConversation, initialMessages, initialHasMore, timeZone }: Props) {
  const id = initialConversation.id;
  const [conversation, setConversation] = useState(initialConversation);
  const [messages, setMessages] = useState(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const requestId = useRef(0);

  /** Relee la conversación y los últimos mensajes; conserva los anteriores ya cargados. */
  const refresh = useCallback(async () => {
    const current = ++requestId.current;
    try {
      const response = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { conversation: ConversationDetail; messages: MessageDto[] };
      if (current !== requestId.current) return;
      setConversation(data.conversation);
      setMessages((prev) => merge(prev, data.messages));
    } catch {
      // sin red: el próximo evento o la reconexión (resync) volverán a intentarlo
    }
  }, [id]);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useRealtime((event) => {
    if (event.type === "appointment.changed") return;
    if (event.type !== "resync" && event.conversationId !== id) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(), 150);
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  // Abre al final; luego sigue al final solo si la persona ya estaba abajo.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const loadOlder = async () => {
    const oldest = messages[0];
    if (!oldest) return;
    const el = scroller.current;
    const previousHeight = el?.scrollHeight ?? 0;
    stick.current = false;
    try {
      const response = await fetch(`/api/conversations/${id}?before=${oldest.id}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { messages: MessageDto[]; hasMore: boolean };
      setMessages((prev) => merge(prev, data.messages));
      setHasMore(data.hasMore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - previousHeight;
      });
    } catch {
      setError("No se pudieron cargar los mensajes anteriores.");
    }
  };

  const toggleBot = async () => {
    const next = !conversation.botActive;
    const before = conversation;
    setToggling(true);
    setError(null);
    setConversation({ ...conversation, botActive: next, handoffReason: next ? null : "Apagado manualmente" });
    const result = await setBotActiveAction(id, next);
    setToggling(false);
    if (!result.ok) {
      setConversation(before);
      setError(result.error);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const result = await sendHumanMessageAction(id, text);
    setSending(false);
    if (!result.ok) return setError(result.error);
    setDraft("");
    stick.current = true;
    setMessages((prev) => merge(prev, [result.message]));
    setConversation((c) => ({ ...c, botActive: false, handoffReason: c.botActive ? "Respondió una persona" : c.handoffReason }));
    void refresh();
  };

  const windowOpen = replyWindowOpen(conversation.lastInboundAt);
  const name = conversation.contactName ?? conversation.waPhone;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Link href="/conversaciones" aria-label="Volver a la lista" className="flex size-8 items-center justify-center rounded-control hover:bg-subtle md:hidden">
          <ArrowLeft size={18} />
        </Link>
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-subtle text-xs font-semibold text-ink-2">
          {initials(conversation.contactName, conversation.waPhone)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{name}</h2>
          <p className="truncate text-xs text-ink-3">{conversation.contactName ? conversation.waPhone : "Número de WhatsApp"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Badge tone={conversation.botActive ? "accent" : "warn"}>{conversation.botActive ? "Bot activo" : "Bot apagado"}</Badge>
          <button
            type="button"
            role="switch"
            aria-checked={conversation.botActive}
            aria-label="Bot activo en esta conversación"
            disabled={toggling}
            onClick={toggleBot}
            className={cn(
              "relative h-6 w-11 rounded-full transition-colors disabled:opacity-60",
              conversation.botActive ? "bg-accent" : "bg-line-strong",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform",
                conversation.botActive ? "translate-x-5" : "translate-x-0",
              )}
            />
          </button>
        </div>
      </header>

      {!conversation.botActive && conversation.handoffReason ? (
        <p className="flex items-center gap-2 border-b border-line bg-warn-soft px-4 py-2 text-xs text-warn">
          <User size={14} aria-hidden /> Atiende una persona. Motivo: {conversation.handoffReason}.
        </p>
      ) : null}

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-canvas px-4 py-4"
      >
        {hasMore ? (
          <div className="pb-2 text-center">
            <Button variant="ghost" type="button" onClick={loadOlder} className="h-8 text-xs">
              Cargar mensajes anteriores
            </Button>
          </div>
        ) : null}
        {messages.length === 0 ? <p className="py-10 text-center text-sm text-ink-3">Aún no hay mensajes.</p> : null}
        {messages.map((m, index) => {
          const previous = messages[index - 1];
          const separator = !previous || dayKey(m.createdAt, timeZone) !== dayKey(previous.createdAt, timeZone);
          const mine = m.direction === "outbound";
          const newGroup = separator || !previous || previous.sender !== m.sender;
          return (
            <div key={m.id}>
              {separator ? (
                <p className="py-3 text-center text-xs font-medium text-ink-3">
                  <span className="rounded-full bg-subtle px-3 py-1">{dayLabel(m.createdAt, timeZone)}</span>
                </p>
              ) : null}
              <div className={cn("flex", mine ? "justify-end" : "justify-start", newGroup && !separator ? "pt-2" : "")}>
                <div className="max-w-[80%]">
                  {newGroup ? (
                    <p className={cn("mb-0.5 flex items-center gap-1 text-xs text-ink-3", mine && "justify-end")}>
                      {m.sender === "bot" ? <Robot size={12} aria-hidden /> : m.sender === "human" ? <User size={12} aria-hidden /> : null}
                      {SENDER_LABEL[m.sender]}
                    </p>
                  ) : null}
                  <div
                    className={cn(
                      "rounded-panel px-3 py-2 text-sm break-words whitespace-pre-wrap",
                      m.sender === "contact" && "border border-line bg-surface text-ink",
                      m.sender === "bot" && "bg-accent-soft text-accent-ink",
                      m.sender === "human" && "bg-accent text-on-accent",
                    )}
                  >
                    {m.content ?? <span className="italic opacity-70">(mensaje sin texto)</span>}
                    <time dateTime={m.createdAt} className={cn("ml-2 inline-block text-[11px] opacity-70", "align-baseline")}>
                      {clock(m.createdAt, timeZone)}
                    </time>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="space-y-2 border-t border-line bg-surface p-3">
        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
            <WarningCircle size={16} className="mt-0.5 shrink-0" aria-hidden /> {error}
          </p>
        ) : null}
        {!windowOpen ? (
          <p className="rounded-control bg-subtle px-3 py-2 text-sm text-ink-2">
            Han pasado más de 24 h desde el último mensaje del cliente. WhatsApp no permite responder con texto libre hasta que escriba de nuevo.
          </p>
        ) : (
          <>
            {conversation.botActive ? (
              <p className="text-xs text-ink-3">El bot está activo: al enviar tu mensaje se apagará en esta conversación.</p>
            ) : null}
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                maxLength={MAX_LENGTH}
                placeholder="Escribe una respuesta… (Intro para enviar, Mayús+Intro para salto de línea)"
                aria-label="Mensaje"
                className="min-h-[2.75rem] flex-1 resize-none rounded-control border border-line-strong bg-surface px-3 py-2 text-sm placeholder:text-ink-4"
              />
              <Button type="submit" disabled={sending || !draft.trim()} className="h-11">
                <PaperPlaneRight size={16} weight="fill" aria-hidden />
                {sending ? "Enviando…" : "Enviar"}
              </Button>
            </form>
          </>
        )}
      </footer>
    </div>
  );
}
