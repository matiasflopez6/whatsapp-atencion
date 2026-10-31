import { Panel } from "@/components/ui/page";
import type { DaySeries } from "@/lib/panel/dashboard";

const SERIES = [
  { key: "contact", label: "Clientes", className: "bg-ink-4" },
  { key: "bot", label: "Bot", className: "bg-accent" },
  { key: "human", label: "Equipo", className: "bg-ink" },
] as const;

const shortDay = (key: string) => {
  const [, m, d] = key.split("-");
  return `${Number(d)}/${Number(m)}`;
};

/** Barras apiladas con CSS (sin dependencias): mensajes por día y quién los envió. */
export function MessagesChart({ series }: { series: DaySeries[] }) {
  const totals = series.map((d) => d.contact + d.bot + d.human);
  const max = Math.max(1, ...totals);
  const sum = totals.reduce((a, b) => a + b, 0);

  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Mensajes por día</h2>
          <p className="text-xs text-ink-3">Últimos {series.length} días · {sum} mensajes</p>
        </div>
        <ul className="flex gap-3 text-xs text-ink-3">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-sm ${s.className}`} aria-hidden /> {s.label}
            </li>
          ))}
        </ul>
      </div>
      {sum === 0 ? (
        <p className="py-12 text-center text-sm text-ink-3">Todavía no hay mensajes en este periodo.</p>
      ) : (
        <div className="mt-4 flex h-40 items-end gap-1.5" role="img" aria-label={`Mensajes por día: ${series.map((d, i) => `${shortDay(d.key)} ${totals[i]}`).join(", ")}`}>
          {series.map((d, i) => (
            <div key={d.key} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1" title={`${shortDay(d.key)}: ${d.contact} de clientes, ${d.bot} del bot, ${d.human} del equipo`}>
              <div className="flex flex-col-reverse overflow-hidden rounded-t-sm" style={{ height: `${(totals[i]! / max) * 100}%` }}>
                {SERIES.map((s) => (
                  <div key={s.key} className={s.className} style={{ height: totals[i] ? `${(d[s.key] / totals[i]!) * 100}%` : 0 }} />
                ))}
              </div>
              <span className="text-center text-[10px] text-ink-4">{shortDay(d.key)}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
