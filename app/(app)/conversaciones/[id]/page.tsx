import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Conversación" };

// Placeholder de ruta: el detalle de conversación lo implementa el hilo de Conversaciones.
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  await params;
  notFound();
}
