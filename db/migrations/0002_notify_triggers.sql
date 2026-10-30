-- Tiempo real: NOTIFY por cada mensaje nuevo y cada cambio relevante de conversación.
-- El payload solo lleva IDs (límite de NOTIFY ≈ 8 KB). Lo consume lib/realtime/listener.ts.
CREATE OR REPLACE FUNCTION notify_message_created() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('org_events', json_build_object(
    'organization_id', NEW.organization_id,
    'conversation_id', NEW.conversation_id,
    'type', 'message.created',
    'id', NEW.id
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER messages_notify_insert
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION notify_message_created();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_conversation_updated() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('org_events', json_build_object(
    'organization_id', NEW.organization_id,
    'conversation_id', NEW.id,
    'type', 'conversation.updated',
    'id', NEW.id
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER conversations_notify_update
  AFTER UPDATE OF bot_active, last_message_at ON conversations
  FOR EACH ROW EXECUTE FUNCTION notify_conversation_updated();
