"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatsCircle, MagnifyingGlass } from "@phosphor-icons/react";
import { LiveIndicator } from "@/components/live-indicator";
import { Badge } from "@/components/ui/badge";
import { initials, listTime } from "@/lib/panel/format";
import type { ConversationFilter, ConversationSummary } from "@/lib/panel/types";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { cn } from "@/lib/utils";

const FILTERS: { value: ConversationFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "attention", label: "Con humano" },
  { value: "bot", label: "Con bot" },
];

const SENDER_PREFIX = { contact: "", bot: "Bot: ", human: "Tú: " } as const;

/** Lista de conversaciones (izquierda) + panel de la conversación abierta (derecha). La lista se mantiene al navegar. */
export function ConversationsShell({
  initial,
  timeZone,
  children,
}: {
  initial: ConversationSummary[];
  timeZone: string;
  children: React.ReactNode;
}) {
  const selected = useSelectedLayoutSegment();
  const [items, setItems] = useState(initial);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [error, setError] = useState(false);
  const request = useRef(0);
  const filters = useRef({ query, filter });
  const firstRun = useRef(true);

  const refresh = useCallback(async () => {
    const id = ++request.current;
    const { query, filter } = filters.current;
    try {
      const params = new URLSearchParams({ filter });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/conversations?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { conversations: ConversationSummary[] };
      if (id === request.current) {
        setItems(data.conversations);
        setError(false);
      }
    } catch {
      if (id === request.current) setError(true);
    }
  }, []);

  // Búsqueda y filtro: se piden al servidor (con una pequeña espera al teclear).
  useEffect(() => {
    filters.current = { query, filter };
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = setTimeout(() => void refresh(), 250);
    return () => clearTimeout(timer);
  }, [query, filter, refresh]);

  const liveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useRealtime((event) => {
    if (event.type === "appointment.changed") return;
    clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => void refresh(), 200);
  });
  useEffect(() => () => clearTimeout(liveTimer.current), []);

  const filtering = query.trim() !== "" || filter !== "all";

  return (
    <div className="flex h-[calc(100dvh-13.5rem)] min-h-[30rem] overflow-hidden rounded-panel border border-line bg-surface">
      <aside className={cn("w-full shrink-0 flex-col border-line md:flex md:w-80 md:border-r lg:w-96", selected ? "hidden" : "flex")}>
        <div className="space-y-3 border-b border-line p-3">
          <div className="relative">
            <MagnifyingGlass size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-4" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o teléfono"
              aria-label="Buscar conversaciones"
              className="h-9 w-full rounded-control border border-line-strong bg-surface pr-3 pl-9 text-sm placeholder:text-ink-4"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div role="tablist" aria-label="Filtrar conversaciones" className="flex gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.value}
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "h-7 rounded-full px-2.5 text-xs font-medium transition-colors",
                    filter === f.value ? "bg-accent-soft text-accent-ink" : "text-ink-3 hover:bg-subtle",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <LiveIndicator />
          </div>
        </div>

        {error ? <p role="alert" className="border-b border-line bg-danger-soft px-3 py-2 text-xs text-danger">No se pudo actualizar la lista. Se reintentará con el próximo mensaje.</p> : null}

        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {items.length === 0 ? (
            <li className="flex flex-col items-center px-6 py-14 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-subtle text-ink-3">
                <ChatsCircle size={20} />
              </span>
              <p className="mt-3 text-sm font-medium">{filtering ? "Sin resultados" : "Sin conversaciones todavía"}</p>
              <p className="mt-1 text-sm text-ink-3">
                {filtering ? "Prueba con otra búsqueda o filtro." : "Cuando un cliente escriba a tu número de WhatsApp, la conversación aparecerá aquí."}
              </p>
            </li>
          ) : (
            items.map((c) => {
              const active = selected === c.id;
              return (
                <li key={c.id}>
                  <Link
                    href={`/conversaciones/${c.id}`}
                    aria-current={active ? "page" : undefined}
                    className={cn("flex gap-3 px-3 py-3 transition-colors", active ? "bg-accent-soft" : "hover:bg-canvas")}
                  >
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-subtle text-xs font-semibold text-ink-2"
                    >
                      {initials(c.contactName, c.waPhone)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{c.contactName ?? c.waPhone}</span>
                        <time dateTime={c.lastMessageAt} className="shrink-0 text-xs text-ink-3">
                          {listTime(c.lastMessageAt, timeZone)}
                        </time>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-ink-3">
                          {c.preview ? `${c.previewSender ? SENDER_PREFIX[c.previewSender] : ""}${c.preview}` : "Sin mensajes"}
                        </span>
                        {!c.botActive ? <Badge tone="warn">Humano</Badge> : null}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      <section className={cn("min-w-0 flex-1 flex-col md:flex", selected ? "flex" : "hidden")}>{children}</section>
    </div>
  );
}
