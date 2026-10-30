-- Rol de runtime para el aislamiento multi-tenant (ver lib/db/tenant.ts).
-- withTenant() hace `SET LOCAL ROLE app_runtime` dentro de la transacción: este rol no es dueño
-- de las tablas, no tiene BYPASSRLS y solo recibe los GRANT mínimos de abajo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
-- El usuario con el que conecta la app debe poder asumir el rol (SET ROLE).
DO $$
BEGIN
  EXECUTE format('GRANT app_runtime TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'GRANT app_runtime TO % omitido: %', current_user, SQLERRM;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_runtime;
--> statement-breakpoint
-- Tablas de negocio: CRUD bajo RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  profiles, whatsapp_configs, google_calendar_configs, agent_configs,
  contacts, conversations, messages, appointments, webhook_events
TO app_runtime;
--> statement-breakpoint
-- La organización solo se lee y edita desde el tenant; se crea y borra con operaciones de sistema.
GRANT SELECT, UPDATE ON organizations TO app_runtime;
--> statement-breakpoint
-- Las tablas de Better Auth (user, session, account, verification) NO se conceden a app_runtime.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON profiles
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE whatsapp_configs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON whatsapp_configs
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE google_calendar_configs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON google_calendar_configs
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON agent_configs
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON contacts
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON conversations
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON messages
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON appointments
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON webhook_events
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (organization_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.org_id', true), '')::uuid);
