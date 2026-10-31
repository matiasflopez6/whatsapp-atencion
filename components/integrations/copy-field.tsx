"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";

/** Valor de solo lectura con botón de copiar (URL del webhook, token de verificación). */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-control border border-line bg-subtle px-3 py-2 font-mono text-xs text-ink-2">
          {value}
        </code>
        <button
          type="button"
          aria-label={`Copiar ${label}`}
          className="flex size-9 shrink-0 items-center justify-center rounded-control border border-line-strong bg-surface text-ink-2 hover:bg-subtle"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // Sin permiso de portapapeles: el valor sigue visible para copiarlo a mano.
            }
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  );
}
