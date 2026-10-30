import { ChatCircleDots } from "@phosphor-icons/react/dist/ssr";

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight">
      <span className="flex size-7 items-center justify-center rounded-md bg-accent text-white">
        <ChatCircleDots size={16} weight="fill" />
      </span>
      Atención WhatsApp
    </span>
  );
}
