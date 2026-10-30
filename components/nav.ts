import { CalendarBlank, ChatsCircle, GearSix, House, PlugsConnected } from "@phosphor-icons/react/dist/ssr";

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: House },
  { href: "/conversaciones", label: "Conversaciones", icon: ChatsCircle },
  { href: "/citas", label: "Citas", icon: CalendarBlank },
  { href: "/personalizacion", label: "Personalización", icon: GearSix },
  { href: "/integraciones", label: "Integraciones", icon: PlugsConnected },
] as const;
