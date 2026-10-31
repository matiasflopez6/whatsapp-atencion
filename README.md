# Atención WhatsApp

Plataforma SaaS multi-tenant de atención al cliente por WhatsApp: un agente de IA responde, consulta
Google Calendar, agenda citas y pasa la conversación a un humano. Todo corre en Railway con Railway
PostgreSQL como única base de datos.

> Estado: fundación (bootstrap, esquema, RLS, auth, shell) + **integraciones, webhook de WhatsApp,
> agente de IA, Google Calendar y cron de reproceso**. Tiempo real, conversaciones, citas,
> personalización, dashboard y Railway IaC los construyen otros hilos sobre este contrato.

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
`db:verify` (comprueba aislamiento RLS y triggers NOTIFY), `cron:reprocess` (reprocesa `webhook_events`; en Railway corre el bundle de `build:scripts`), `test` (unitarios + flujo completo con Postgres local y Meta/Google/modelo simulados), `typecheck`, `lint`.

## Convenciones (léelas antes de añadir código)

### Estructura

```
app/(marketing)  landing        app/(auth)  login, signup, actions.ts (Server Actions de auth)
app/(app)        panel autenticado (layout con sidebar; el layout llama a requireSession())
app/api          auth/[...all], auth/google/{start,callback}, health, webhooks/whatsapp  (realtime: otro hilo)
db/schema/*.ts   esquema Drizzle (auth.ts = tablas de Better Auth)   db/types.ts  tipos inferidos
db/migrations    SQL generado + migraciones custom (RLS, roles, triggers)
db/seed.ts, db/verify-isolation.ts
lib/env.ts       variables validadas con Zod (getEnv())               lib/crypto.ts  encrypt()/decrypt()
lib/db/index.ts  pool + drizzle base (NO importar fuera de lib/db, lib/auth.ts, seed y scripts: lo impide ESLint)
lib/db/tenant.ts withTenant()      lib/db/system.ts  operaciones de sistema documentadas
lib/auth.ts      Better Auth       lib/session.ts    getSession() / requireSession()
components/ui    Button, Field/Input, Badge, PageHeader, Panel, EmptyState
lib/whatsapp     client (envío, test de conexión), signature (HMAC), payload, ingest (POST→inbox), process (inbox→agente→respuesta)
lib/agent        model.ts (ANTHROPIC_MODEL), prompt.ts, tools.ts (4 herramientas), run.ts (generateText)
lib/google       oauth, calendar (FreeBusy/eventos/calendarios), availability (slots), time (zonas horarias)
scripts/reprocess-webhooks.ts   cron; tests/   node:test con tsx
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

Tokens y secretos de terceros se guardan con `encrypt()` (AES-256-GCM, formato `v1.iv.tag.data`) y se leen con `decrypt()`. Variables siempre vía `getEnv()`; las nuevas se añaden a `lib/env.ts` y `.env.example`. `ANTHROPIC_API_KEY` y `GOOGLE_*` siguen siendo opcionales **a propósito** (ver «WhatsApp, agente y Google Calendar»): sin ellas la app arranca, `/integraciones` avisa de qué falta y el agente pasa la conversación a una persona en lugar de inventar. Las credenciales de Meta (token, App Secret) son por organización y se guardan cifradas desde `/integraciones`, no como variables de entorno.

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

## WhatsApp, agente y Google Calendar

**Webhook** (`/api/webhooks/whatsapp`):
- `GET`: verificación; el `hub.verify_token` (`{slug}:{secreto}`, se genera al guardar las credenciales y se muestra en `/integraciones`) identifica al negocio.
- `POST`: lee el body crudo, resuelve la organización por `phone_number_id`, valida `X-Hub-Signature-256` (HMAC-SHA256, comparación en tiempo constante) con el **App Secret de esa organización**, guarda un `webhook_events` por mensaje (idempotente por `message.id`) y responde 200; el procesamiento corre en `after()`. Firma inválida → 401; error al guardar → 500 (Meta reintenta). Un número desconocido se ignora con 200 y log.
- Los `statuses` (entregado/leído) se ignoran en v1. Los mensajes no textuales llegan al agente como marcador y este pide que escriban.
- **mTLS de Meta**: el TLS termina en el edge de Railway; la app no valida certificados de cliente y la autenticidad la da el HMAC. Si algún día se pone un proxy propio con `ssl_verify_client`, debe confiar en la CA `meta-outbound-api-ca-2025-12.pem` (ver `docs/decisions.md` del hilo de Railway, PR #1).

**Inbox y reproceso**: `webhook_events` (`pending → processing → done | failed`). `after()` reclama el evento; si el proceso muere (redeploy/SIGTERM) o falla, `pnpm cron:reprocess` (cada 5 min en Railway) reclama con `FOR UPDATE SKIP LOCKED` los `pending` de más de 30 s y los `processing` con bloqueo de más de 5 min. Máximo 5 intentos; al agotarlos el evento queda `failed`, el bot se apaga en esa conversación y se avisa al cliente con el mensaje de traspaso. Cada respuesta del bot guarda `raw.inReplyTo`, así un reintento no duplica una respuesta ya enviada. Si entra un mensaje nuevo mientras el agente piensa, se descarta la respuesta vieja (responde el turno más reciente con todo el contexto), salvo que ese turno ya haya agendado o traspasado. La exclusión es **en proceso** (`lib/mutex.ts`): Railway corre una instancia de `web`.

**Agente** (`lib/agent`): `generateText` de AI SDK con `anthropic(ANTHROPIC_MODEL)` y `stopWhen: isStepCount(6)`. El system prompt (`prompt.ts`) = prompt editable de `agent_configs` + tono + servicios + horarios + hora actual + **reglas fijas** que el dueño no puede quitar (no ofrecer horarios que no salgan de `check_availability`; no confirmar citas hasta que `book_appointment` devuelva `confirmed: true`). Herramientas: `check_availability` (FreeBusy real → hasta 3 horarios repartidos), `book_appointment` (revalida horario y FreeBusy, crea el evento en Google, guarda la cita y deshace el evento si falla el guardado; idempotente; una reserva a la vez por organización), `get_business_info` y `handoff_to_human` (apaga `bot_active` y guarda `handoff_reason`). Si Google falla o está desconectado, la herramienta devuelve `calendar_unavailable` y el agente ofrece pasar con una persona: nunca se asume que algo esté libre.

**Google Calendar**: OAuth 2.0 con `fetch` (sin `googleapis`, para no añadir una dependencia enorme por tres endpoints). Scope `calendar`, `access_type=offline`, `prompt=consent`, `state` firmado (organización + nonce + caducidad) y cookie `httpOnly`; el callback exige que la organización del `state` sea la de la sesión. Redirect URI: `${APP_URL}/api/auth/google/callback` (la ruta estática gana al catch-all de Better Auth; verificado). Tokens cifrados; `invalid_grant` marca la integración «Desconectada» en `/integraciones`. Tras conectar se usa el calendario principal y el dueño puede elegir otro. Con la app de Google en modo *Testing* los refresh tokens caducan a los 7 días. Los redirects de las rutas de OAuth usan `APP_URL`, no `request.url` (en el standalone con `HOSTNAME=0.0.0.0` este último trae el host interno).

**Decisiones de versión (verificadas el 2026-10-30)**: Graph API `v26.0` (`lib/whatsapp/constants.ts`); `ai@7.0.157` y `@ai-sdk/anthropic@4.0.92` (no «AI SDK 6»; la condición de parada es `isStepCount`, `stepCountIs` queda como alias); modelo `claude-sonnet-5-5` en `lib/agent/model.ts`. No se fija `temperature`: no se pudo confirmar su aceptación con Sonnet 5.5 sin API key y el valor por defecto basta. El indicador «escribiendo…» (`typing_indicator` en el POST de «leído») se envía en mejor esfuerzo y no bloquea nada; no se ha verificado contra Meta real.

**Pendiente de credenciales reales** (hasta entonces todo está cubierto por tests con mocks): `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (variables compartidas de Railway / `.env.local`) y, por organización y desde `/integraciones`: Phone number ID, WABA ID, token de System User y App Secret de Meta.

## Seguridad

Aislamiento en dos capas (`withTenant` + RLS bajo `app_runtime`, sin `BYPASSRLS`), tokens cifrados, cookies `httpOnly`, sin secretos en el repo (`.env*` ignorado salvo `.env.example`). `pnpm db:verify` ejecuta las pruebas de aislamiento (queries sin filtro, escritura cruzada, acceso a tablas de auth y NOTIFY).
