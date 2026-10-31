"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { List, SignOut, X } from "@phosphor-icons/react";
import { Logo } from "@/components/logo";
import { NAV_ITEMS } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type Props = {
  organizationName: string;
  userName: string;
  userEmail: string;
  logoutAction: () => Promise<void>;
};

export function Sidebar({ organizationName, userName, userEmail, logoutAction }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav aria-label="Principal" className="flex-1 space-y-0.5 px-3 py-3">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-control px-2.5 text-sm font-medium transition-colors",
              active ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-subtle",
            )}
          >
            <Icon size={18} weight={active ? "fill" : "regular"} />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-line p-3">
      <div className="px-2.5 pb-2">
        <p className="truncate text-sm font-medium">{userName}</p>
        <p className="truncate text-xs text-ink-3">{userEmail}</p>
      </div>
      <div className="px-2.5 pb-2">
        <ThemeToggle />
      </div>
      <form action={logoutAction}>
        <button
          type="submit"
          className="flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-sm text-ink-2 transition-colors hover:bg-subtle"
        >
          <SignOut size={18} />
          Cerrar sesión
        </button>
      </form>
    </div>
  );

  const header = (
    <div className="px-4 pt-4 pb-2">
      <Logo />
      <p className="mt-3 truncate rounded-control bg-subtle px-2.5 py-1.5 text-xs font-medium text-ink-2" title={organizationName}>
        {organizationName}
      </p>
    </div>
  );

  return (
    <>
      {/* Escritorio */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        {header}
        {nav}
        {footer}
      </aside>

      {/* Móvil */}
      <div className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-line bg-surface px-4 md:hidden">
        <Logo />
        <button
          type="button"
          aria-label="Abrir menú"
          onClick={() => setOpen(true)}
          className="flex size-9 items-center justify-center rounded-control hover:bg-subtle"
        >
          <List size={20} />
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-30 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-surface shadow-xl">
            <button
              type="button"
              aria-label="Cerrar menú"
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-control hover:bg-subtle"
            >
              <X size={18} />
            </button>
            {header}
            {nav}
            {footer}
          </aside>
        </div>
      ) : null}
    </>
  );
}
