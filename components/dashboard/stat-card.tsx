import Link from "next/link";
import { Panel } from "@/components/ui/page";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  tone?: "default" | "warn";
}) {
  const body = (
    <Panel className={cn("h-full p-4 transition-colors", href && "hover:border-line-strong", tone === "warn" && "border-warn/30 bg-warn-soft/40")}>
      <p className="text-sm text-ink-3">{label}</p>
      <p className="mt-1.5 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
    </Panel>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-panel">
      {body}
    </Link>
  ) : (
    body
  );
}
