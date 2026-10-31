"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, Flask, PaperPlaneRight, WarningCircle } from "@phosphor-icons/react";
import { testAgentAction } from "@/app/(app)/personalizacion/actions";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/page";
import { cn } from "@/lib/utils";

type Turn = { role: "user" | "assistant"; content: string; notes?: string[] };

const TOOL_LABEL: Record<string, string> = {
  check_availability: "Consultó la disponibilidad real en Google Calendar",
  book_appointment: "Simuló agendar la cita (no se creó ninguna)",
  get_business_info: "Consultó la información del negocio",
  handoff_to_human: "Simuló pasar la conversación a una persona",
};

export function AgentSandbox() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns, pending]);

  const send = async () => {
    const text = draft.trim();
    if (!text || pending) return;
    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setDraft("");
    setError(null);
    setPending(true);
    const result = await testAgentAction(next.map(({ role, content }) => ({ role, content })));
    setPending(false);
    if (!result.ok) return setError(result.error);
    const notes = [...new Set(result.tools)].map((t) => TOOL_LABEL[t] ?? t);
    setTurns([...next, { role: "assistant", content: result.text || "(el agente no devolvió texto)", notes }]);
  };

  return (
    <Panel className="flex h-[min(36rem,calc(100dvh-8rem))] flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Flask size={18} className="text-accent" aria-hidden />
          <h2 className="text-sm font-semibold">Probar agente</h2>
        </div>
        <Button variant="ghost" type="button" className="h-8 text-xs" disabled={turns.length === 0 && !error} onClick={() => { setTurns([]); setError(null); }}>
          <ArrowCounterClockwise size={14} /> Reiniciar
        </Button>
      </header>
      <p className="border-b border-line bg-canvas px-4 py-2 text-xs text-ink-3">
        Usa la configuración <strong>guardada</strong> y la agenda real, pero no envía mensajes ni crea citas.
      </p>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-canvas px-4 py-4">
        {turns.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-3">Escribe como si fueras un cliente: «Hola, quiero una cita para el jueves».</p>
        ) : null}
        {turns.map((turn, i) => (
          <div key={i} className={cn("flex", turn.role === "user" ? "justify-end" : "justify-start")}>
            <div className="max-w-[85%] space-y-1">
              <div
                className={cn(
                  "rounded-panel px-3 py-2 text-sm break-words whitespace-pre-wrap",
                  turn.role === "user" ? "bg-accent text-on-accent" : "border border-line bg-surface text-ink",
                )}
              >
                {turn.content}
              </div>
              {turn.notes?.map((note) => (
                <p key={note} className="text-[11px] text-ink-3">
                  ⚙ {note}
                </p>
              ))}
            </div>
          </div>
        ))}
        {pending ? <p className="text-xs text-ink-3">El agente está escribiendo…</p> : null}
        <div ref={end} />
      </div>

      <footer className="space-y-2 border-t border-line bg-surface p-3">
        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
            <WarningCircle size={16} className="mt-0.5 shrink-0" aria-hidden /> {error}
          </p>
        ) : null}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={1000}
            placeholder="Mensaje de prueba…"
            aria-label="Mensaje de prueba"
            className="h-9 min-w-0 flex-1 rounded-control border border-line-strong bg-surface px-3 text-sm placeholder:text-ink-4"
          />
          <Button type="submit" disabled={pending || !draft.trim()} aria-label="Enviar mensaje de prueba">
            <PaperPlaneRight size={16} weight="fill" />
          </Button>
        </form>
      </footer>
    </Panel>
  );
}
