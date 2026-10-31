"use client";

import { useRealtimeStatus } from "@/lib/realtime/use-realtime";
import { cn } from "@/lib/utils";

const COPY = { live: "En vivo", connecting: "Reconectando…", offline: "Sin conexión en vivo" } as const;

/** Estado de la conexión de tiempo real (SSE). */
export function LiveIndicator({ className }: { className?: string }) {
  const status = useRealtimeStatus();
  return (
    <span
      role="status"
      title={status === "offline" ? "Recarga la página para volver a conectar" : undefined}
      className={cn("inline-flex items-center gap-1.5 text-xs text-ink-3", className)}
    >
      <span
        aria-hidden
        className={cn("size-2 rounded-full", status === "live" ? "bg-accent" : status === "connecting" ? "animate-pulse bg-warn" : "bg-danger")}
      />
      {COPY[status]}
    </span>
  );
}
