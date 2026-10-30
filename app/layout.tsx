import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Atención WhatsApp", template: "%s · Atención WhatsApp" },
  description: "Agente de IA para atender a tus clientes por WhatsApp, agendar citas y pasar a un humano cuando hace falta.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
