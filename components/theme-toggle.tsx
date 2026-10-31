"use client";

import { useSyncExternalStore } from "react";
import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "theme";
const CHANGE_EVENT = "theme-change";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Tema claro", icon: Sun },
  { value: "system", label: "Tema del sistema", icon: Desktop },
  { value: "dark", label: "Tema oscuro", icon: Moon },
];

function readTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system"; // almacenamiento bloqueado (modo privado, etc.)
  }
}

function applyTheme(theme: Theme) {
  // Sin preferencia explícita se quita el atributo y manda prefers-color-scheme (ver app/globals.css).
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // la preferencia vale para esta visita aunque no pueda guardarse
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange); // otras pestañas
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Selector claro / sistema / oscuro. La preferencia se guarda en el navegador (localStorage). */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);

  return (
    <div role="radiogroup" aria-label="Tema de la interfaz" className={cn("inline-flex rounded-control border border-line-strong bg-surface p-0.5", className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => applyTheme(value)}
            className={cn(
              "flex size-7 items-center justify-center rounded-[0.375rem] transition-colors",
              active ? "bg-accent-soft text-accent-ink" : "text-ink-3 hover:bg-subtle hover:text-ink",
            )}
          >
            <Icon size={16} weight={active ? "fill" : "regular"} />
          </button>
        );
      })}
    </div>
  );
}
