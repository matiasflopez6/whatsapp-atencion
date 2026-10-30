import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover disabled:bg-ink-4",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-subtle disabled:text-ink-4",
  ghost: "text-ink-2 hover:bg-subtle disabled:text-ink-4",
  danger: "bg-danger text-white hover:opacity-90 disabled:opacity-50",
};

export function buttonClass(variant: Variant = "primary", className?: string) {
  return cn(
    "inline-flex h-9 items-center justify-center gap-2 rounded-control px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed",
    variants[variant],
    className,
  );
}

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}
