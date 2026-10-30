import type {
  account,
  agentConfigs,
  appointments,
  contacts,
  conversations,
  googleCalendarConfigs,
  messages,
  organizations,
  profiles,
  session,
  user,
  webhookEvents,
  whatsappConfigs,
} from "./schema";

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type WhatsappConfig = typeof whatsappConfigs.$inferSelect;
export type NewWhatsappConfig = typeof whatsappConfigs.$inferInsert;
export type GoogleCalendarConfig = typeof googleCalendarConfigs.$inferSelect;
export type NewGoogleCalendarConfig = typeof googleCalendarConfigs.$inferInsert;
export type AgentConfig = typeof agentConfigs.$inferSelect;
export type NewAgentConfig = typeof agentConfigs.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;

export type { ServiceConfig, BusinessHours } from "./schema/agent";
