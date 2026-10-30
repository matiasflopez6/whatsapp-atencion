# Atención WhatsApp

Plataforma SaaS multi-tenant de atención al cliente por WhatsApp: un agente de IA responde, consulta
Google Calendar, agenda citas y pasa la conversación a un humano. Todo corre en Railway con Railway
PostgreSQL como única base de datos.

> Estado: **fundación** (bootstrap, esquema, RLS, auth, shell). Integraciones, webhook, agente,
> tiempo real, citas, personalización, dashboard y cron los construyen hilos posteriores sobre este
> contrato. Las secciones de Meta, Google y Railway se completan con esos hilos.

## Setup local

Requisitos: Node ≥ 22.12, pnpm 10 y un Postgres local (o el `DATABASE_PUBLIC_URL` del entorno `development` de Railway).

```bash
pnpm install
cp .env.example .env.local     # rellena DATABASE_URL, ENCRYPTION_KEY y BETTER_AUTH_SECRET
openssl rand -base64 32        # úsalo para ENCRYPTION_KEY y de nuevo para BETTER_AUTH_SECRET
pnpm db:migrate                # aplica /db/migrations (incluye rol app_runtime, RLS y triggers)
pnpm db:seed                   # 2 organizaciones de ejemplo (solo desarrollo)
pnpm dev                       # http://localhost:3000
```

Usuarios del seed (contraseña `SEED_PASSWORD`, por defecto `seed-password-123`):
`owner@clinica-sonrisa.test` y `owner@barberia-norte.test`.

Scripts: `dev`, `build`, `build:scripts`, `start`, `db:generate`, `db:migrate`, `db:seed`,
`db:verify` (comprueba aislamiento RLS y triggers NOTIFY), `cron:reprocess` (pendiente), `typecheck`, `lint`.

## Convenciones (léelas antes de añadir código)

### Estructura

```
app/(marketing)  landing        app/(auth)  login, signup, actions.ts (Server Actions de auth)
app/(app)        panel autenticado (layout con sidebar; el layout llama a requireSession())
app/api          auth/[...all], health, (webhooks, realtime, google: otros hilos)
db/schema/*.ts   esquema Drizzle (auth.ts = tablas de Better Auth)   db/types.ts  tipos inferidos
db/migrations    SQL generado + migraciones custom (RLS, roles, triggers)
db/seed.ts, db/verify-isolation.ts
lib/env.ts       variables validadas con Zod (getEnv())               lib/crypto.ts  encrypt()/decrypt()
lib/db/index.ts  pool + drizzle base (NO importar fuera de lib/db, lib/auth.ts, seed y scripts: lo impide ESLint)
lib/db/tenant.ts withTenant()      lib/db/system.ts  operaciones de sistema documentadas
lib/auth.ts      Better Auth       lib/session.ts    getSession() / requireSession()
components/ui    Button, Field/Input, Badge, PageHeader, Panel, EmptyState
```

### Datos: `withTenant()`

Todo acceso a tablas de negocio pasa por `withTenant(organizationId, async (tx) => …)`. Abre una
transacción, hace `SET LOCAL ROLE app_runtime` y fija `app.org_id`; RLS limita cualquier query,
incluso sin `WHERE`, a esa organización.

```ts
import { withTenant } from "@/lib/db/tenant";
import { requireSession } from "@/lib/session";

const { organizationId } = await requireSession();           // panel: SIEMPRE de la sesión
const rows = await withTenant(organizationId, (tx) => tx.select().from(contacts));
```

- El `organizationId` sale de la sesión (panel) o del `phone_number_id` resuelto (webhook); nunca de un parámetro del cliente.
- Excepciones (en `lib/db/system.ts`, sin RLS): healthcheck, perfil/organización del usuario y signup, resolver organización por `phone_number_id`. El cron entra por aquí para listar `webhook_events` y luego usa `withTenant` por evento. Añade operaciones de sistema allí, comentadas, y solo si no hay alternativa.
- **Tabla de negocio nueva** → en su migración custom: `organization_id uuid NOT NULL`, `GRANT … TO app_runtime`, `ENABLE ROW LEVEL SECURITY` y una política `tenant_isolation` igual a las de `0001_roles_rls.sql`; amplía `db/verify-isolation.ts`.
- Las tablas de Better Auth no están concedidas a `app_runtime`.

### Sesión

`getSession()` (memoizada) devuelve `{ user, organizationId, organization, role } | null` verificando la sesión en base de datos; `requireSession()` redirige a `/login`. Úsalas en layouts, páginas, Server Actions y Route Handlers. `proxy.ts` solo hace una comprobación optimista de la cookie. En rutas API devuelve 401 si `getSession()` es `null`.

### Migraciones

`pnpm db:generate` tras cambiar `/db/schema`; `pnpm exec drizzle-kit generate --custom --name=algo` para SQL a mano (separa sentencias con `--> statement-breakpoint`). Se aplican con `pnpm db:migrate` (pre-deploy en Railway).

### Secretos

Tokens y secretos de terceros se guardan con `encrypt()` (AES-256-GCM, formato `v1.iv.tag.data`) y se leen con `decrypt()`. Variables siempre vía `getEnv()`; las nuevas se añaden a `lib/env.ts` y `.env.example`. `ANTHROPIC_API_KEY` y `GOOGLE_*` son hoy opcionales: el hilo que las use debe volverlas obligatorias.

### UI

Fondo claro, grises neutros y un único acento (`--color-accent`, teal). Tokens en `app/globals.css` (`@theme`): `bg-canvas`, `bg-surface`, `bg-subtle`, `border-line`, `text-ink` / `ink-2` / `ink-3`, `bg-accent`, `bg-accent-soft`. Iconos Phosphor (`@phosphor-icons/react/dist/ssr` en Server Components). Estados con `<Badge tone>`; páginas con `<PageHeader>`, `<Panel>` y `<EmptyState>`. Server Components por defecto; `"use client"` solo si hace falta.

## Decisiones técnicas

- **Next.js 16.2.6 fijado** (versión pedida; la última publicada es 16.4.3). Subir de versión es un cambio de una línea cuando se decida.
- **TypeScript 5.9 y ESLint 9**: TS 7 y ESLint 10 existen, pero `eslint-config-next@16.2.6` apunta a ESLint 9. Next 16 ya no trae `next lint`: se usa `eslint .` con config plana.
- **Better Auth 1.7.14** con `better-auth/adapters/drizzle` (sigue exportado en 1.7; existe también el paquete `@better-auth/drizzle-adapter`). El esquema de `db/schema/auth.ts` está escrito a mano con las columnas del core (`user`, `session`, `account`, `verification`) y verificado con signup/login/logout reales; si se añaden plugins con tablas nuevas, regenerarlo con el CLI (`npx auth@latest generate`).
- **Signup**: el hook `databaseHooks.user.create.after` crea organización + `agent_configs` por defecto + `profiles` en una transacción (`ensureOrganizationForUser`). `getSession()` repite el paso si faltara el perfil (idempotente). El nombre del negocio viaja como `organizationName` en el body del signup.
- `organization_id` es `NOT NULL` en todas las tablas de negocio (más estricto que el prompt original) y los `CHECK` de enums están en la base.
- **`server-only`** (dependencia mínima oficial de React) protege `lib/session.ts` de importarse en el cliente.
- Fuente: pila del sistema (sin dependencias de fuentes ni peticiones a terceros en build).
- Pendiente para otros hilos: AI SDK (hoy `ai` 7.x / `@ai-sdk/anthropic` 4.x frente a "AI SDK 6" del prompt), `GRAPH_API_VERSION`, Railway IaC.

## Seguridad

Aislamiento en dos capas (`withTenant` + RLS bajo `app_runtime`, sin `BYPASSRLS`), tokens cifrados, cookies `httpOnly`, sin secretos en el repo (`.env*` ignorado salvo `.env.example`). `pnpm db:verify` ejecuta las pruebas de aislamiento (queries sin filtro, escritura cruzada, acceso a tablas de auth y NOTIFY).
