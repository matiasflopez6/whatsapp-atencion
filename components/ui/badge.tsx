import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "danger" | "warn";

const tones: Record<Tone, string> = {
  neutral: "bg-subtle text-ink-2",
  accent: "bg-accent-soft text-accent-ink",
  danger: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-warn",
};

/** Estado visible: bot activo/inactivo, cita confirmada/cancelada/completada, integración conectada/pendiente. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}
