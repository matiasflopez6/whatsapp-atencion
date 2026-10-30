-- Tiempo real: NOTIFY cuando se crea una cita o cambia su estado u horario (el agente al agendar,
-- el dueño desde /citas). Mismo canal y forma que 0002; el payload solo lleva IDs.
CREATE OR REPLACE FUNCTION notify_appointment_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('org_events', json_build_object(
    'organization_id', NEW.organization_id,
    'type', 'appointment.changed',
    'id', NEW.id
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER appointments_notify_insert
  AFTER INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION notify_appointment_changed();
--> statement-breakpoint
CREATE TRIGGER appointments_notify_update
  AFTER UPDATE OF status, starts_at, ends_at ON appointments
  FOR EACH ROW EXECUTE FUNCTION notify_appointment_changed();
