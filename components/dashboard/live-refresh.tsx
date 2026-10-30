"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { LiveIndicator } from "@/components/live-indicator";
import { useRealtime } from "@/lib/realtime/use-realtime";

/** Re-renderiza la página del servidor (con datos nuevos) cuando llega cualquier evento en vivo. */
export function LiveRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useRealtime(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 600);
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return <LiveIndicator />;
}
