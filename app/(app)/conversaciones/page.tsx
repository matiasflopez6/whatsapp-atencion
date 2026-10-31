import type { Metadata } from "next";
import { ChatCircleText } from "@phosphor-icons/react/dist/ssr";

export const metadata: Metadata = { title: "Conversaciones" };

export default function Page() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-subtle text-ink-3">
        <ChatCircleText size={20} />
      </span>
      <h2 className="mt-4 text-sm font-semibold">Selecciona una conversación</h2>
      <p className="mt-1 max-w-sm text-sm text-ink-3">Elige un chat de la lista para ver los mensajes, apagar el bot o responder tú mismo.</p>
    </div>
  );
}
