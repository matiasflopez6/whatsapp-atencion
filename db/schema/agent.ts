import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export type ServiceConfig = { name: string; duration_minutes: number; description?: string };
export type BusinessHours = Partial<
  Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", { start: string; end: string }[]>
>;

export const agentConfigs = pgTable("agent_configs", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  systemPrompt: text("system_prompt").notNull(),
  tone: text("tone").notNull().default("profesional y cálido"),
  // Horarios, dirección, FAQ, políticas, etc. Estructura libre editada desde /personalizacion.
  businessInfo: jsonb("business_info").$type<Record<string, unknown>>().notNull().default({}),
  services: jsonb("services").$type<ServiceConfig[]>().notNull().default([]),
  businessHours: jsonb("business_hours").$type<BusinessHours>().notNull().default({}),
  handoffMessage: text("handoff_message").default("Te paso con un humano en un momento."),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
