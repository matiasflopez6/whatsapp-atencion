"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ClientRealtimeEvent } from "./types";

export type RealtimeStatus = "connecting" | "live" | "offline";
type Listener = (event: ClientRealtimeEvent) => void;

type Bus = { status: RealtimeStatus; subscribe: (listener: Listener) => () => void };
const RealtimeContext = createContext<Bus | null>(null);

/**
 * UNA conexión SSE por pestaña (`/api/realtime`), compartida por todos los componentes del panel.
 * Cuando la conexión se restablece emite `resync`: pudo perderse algún evento y conviene releer.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    const source = new EventSource("/api/realtime");
    let hadConnection = false;
    source.onopen = () => {
      setStatus("live");
      if (hadConnection) for (const l of [...listeners.current]) l({ type: "resync" });
      hadConnection = true;
    };
    source.onmessage = (message) => {
      let event: ClientRealtimeEvent;
      try {
        event = JSON.parse(message.data) as ClientRealtimeEvent;
      } catch {
        return;
      }
      for (const l of [...listeners.current]) l(event);
    };
    // EventSource reconecta solo (CONNECTING); si queda CLOSED (p. ej. 401) no hay más intentos.
    source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? "offline" : "connecting");
    return () => source.close();
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const bus = useMemo<Bus>(() => ({ status, subscribe }), [status, subscribe]);
  return <RealtimeContext.Provider value={bus}>{children}</RealtimeContext.Provider>;
}

/** Suscribe `handler` a los eventos en vivo mientras el componente esté montado. */
export function useRealtime(handler: Listener): void {
  const bus = useContext(RealtimeContext);
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const subscribe = bus?.subscribe;
  useEffect(() => {
    if (!subscribe) return;
    return subscribe((event) => ref.current(event));
  }, [subscribe]);
}

export function useRealtimeStatus(): RealtimeStatus {
  return useContext(RealtimeContext)?.status ?? "offline";
}
