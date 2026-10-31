# Decisiones técnicas y verificación de versiones

Verificado el **2026-10-30** contra documentación oficial y el registro de npm. Donde el prompt original
difiere de lo vigente se usa lo vigente (regla del proyecto) y queda anotado aquí.
Re-verificar antes del primer deploy a `production`.

## Resumen de cambios respecto al prompt original

| Tema | Prompt original | Vigente (2026-10-30) | Decisión |
|---|---|---|---|
| Graph API | `v25.0` como punto de partida | **`v26.0`** (publicada 2026-07-29). `v25.0` sigue soportada hasta 2028-07-29 | `GRAPH_API_VERSION = "v26.0"` |
| AI SDK | AI SDK 6 | Paquete `ai` está en **7.x** (`7.0.157`), `@ai-sdk/anthropic` **4.x** (`4.0.92`) | Usar `ai@7` + `@ai-sdk/anthropic@4` (ver abajo) |
| Condición de parada | `stepCountIs(N)` | La documentación usa **`isStepCount(N)`**; `stepCountIs` sigue exportado como alias | Usar `isStepCount` (la sesión del agente) |
| Better Auth + Drizzle | `drizzleAdapter` desde `better-auth` | La doc ahora documenta el paquete separado **`@better-auth/drizzle-adapter`**; `better-auth/adapters/drizzle` sigue funcionando (reexporta el paquete nuevo en 1.7.14) | Sin cambios en la base; migrar al paquete nuevo cuando se actualice Better Auth |
| Generar esquema de Better Auth | CLI de Better Auth | `npx auth@latest generate` (`pnpm dlx auth@latest generate`) | Usar ese comando |
| Next.js | `16.2.6` | `npm latest` = **`16.4.3`** (también existe `16.3.0-preview`) | Recomendado `16.4.3`; si `typecheck` rompe, fijar `16.2.6` y anotarlo |
| mTLS de Meta | "nueva CA desde 31-mar-2026" | Doc vigente: CA `meta-outbound-api-ca-2025-12.pem`; el certificado DigiCert anterior **expiró el 2026-04-15** | Sin cambios en la app; ver sección mTLS |
| Reintentos de webhook | "Meta reintenta durante días" | Doc de WhatsApp: reintenta inmediatamente y luego con frecuencia decreciente **durante 7 días** (la doc genérica de Graph dice 36 h) | Idempotencia por `wa_message_id` se mantiene |
| Cron en IaC | "prueba `deploy.cronSchedule`" | `deploy: { cronSchedule }` **sí compila** en `service()` (tipo `DeployConfig` del SDK `railway@3.16.0`); la doc solo lo muestra para Functions | Usarlo; confirmar con `railway config plan` |

Versiones de paquetes en npm al verificar: `next@16.4.3`, `ai@7.0.157`, `@ai-sdk/anthropic@4.0.92`,
`better-auth@1.7.14`, `@better-auth/drizzle-adapter@1.7.14`, `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`,
`pg@8.23.1`, `zod@4.6.7`, `tailwindcss@4.3.3`, `@phosphor-icons/react@2.1.10`, `railway@3.16.0` (SDK de IaC),
`@railway/cli@5.71.0`.

## Meta / WhatsApp Cloud API

- **Versión de Graph API**: `v26.0` es la última (changelog oficial, 2026-07-29, expiración "TBD"). Cadencia observada
  de 4 a 5,5 meses, no 3. Cada versión vive ≥ 2 años, así que no hay urgencia de migrar. Centralizada en `GRAPH_API_VERSION`.
- **Verificación GET**: `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`. Responder 200 con el `hub.challenge`
  tal cual; cualquier otra cosa se considera fallo.
- **Firma**: cabecera `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 del body crudo con el App Secret. Meta dice
  "no tienes que validar el payload, pero deberías": nosotros siempre validamos (comparación en tiempo constante).
- **Respuesta**: 200 si es válido; cualquier otro código se considera fallo y Meta reintenta (hasta 7 días según la doc
  de WhatsApp). Batches de hasta 1000 actualizaciones: el handler debe iterar `entry[].changes[]`.
- **mTLS**:
  - La doc de Graph (webhooks → "mTLS for Webhooks") indica que el servidor *puede* verificar la identidad del emisor
    con la CA `meta-outbound-api-ca-2025-12.pem` y el CN `client.webhooks.fbclientcerts.com`. Reemplaza al certificado
    firmado por DigiCert, que **expiró el 2026-04-15**. La fecha "31 de marzo de 2026" que citaba el prompt aparece en
    resultados de búsqueda sobre el aviso de Meta, pero no en las páginas vigentes que se leyeron; lo único fechado allí
    es la expiración del 15 de abril.
  - En Railway el TLS termina en el edge y la app Node no ve ni valida certificados de cliente, así que **no hay nada que
    configurar** y el cambio de CA no afecta. La autenticidad del evento la garantiza el HMAC con el App Secret.
    (Es una inferencia de la arquitectura; la documentación de Railway leída no habla de mTLS de cliente.)
  - Si algún día se pone delante un proxy propio con `ssl_verify_client on`, debe confiar en
    `meta-outbound-api-ca-2025-12.pem` (y, por cuestiones de transición, no depender solo de la CA DigiCert).
  - La doc advierte que activar/desactivar mTLS se hace **por aplicación de Meta**, no por número.

## Railway

- **IaC**: `.railway/railway.ts` es GA (TypeScript). `railway.json` / `railway.toml` están **deprecados y dejan de
  leerse el 2026-12-01**. Un servicio no puede ser gestionado por ambos sistemas a la vez. Paquete npm `railway`
  (SDK) + Railway CLI ≥ 5.42.1 (el motor de IaC va en el CLI, no en el SDK; versión actual `@railway/cli@5.71.0`).
- **Una definición = estado deseado completo**: lo que no está en el archivo se **borra** en el siguiente `apply`.
  Consecuencia práctica con PITR: al activarlo Railway crea un bucket `Postgres-PITR` y, al restaurar, un servicio
  hermano `Postgres-restored-YYYYMMDD-HHMM`. Ninguno está en el archivo, así que un `railway config plan` posterior los
  mostrará como borrados. **Revisar siempre el plan** antes de aplicar y, tras activar PITR, declarar el bucket
  (`bucket("Postgres-PITR", ...)`) o confirmar con el plan que no se borra. Los `--confirm-destructive` quedan
  siempre sujetos a aprobación explícita del usuario.
- **Variables compartidas**: `ctx.shared.NOMBRE` compila a `${{shared.NOMBRE}}`; no crea la variable, debe existir antes
  del primer `apply`. Si una compartida opcional (`EMAIL_*`) no existe, no referenciarla (quedaría sin resolver); por
  eso van comentadas en el archivo.
- **Plan**: `railway config plan` oculta valores por defecto (`«hidden»`), `--json` para salida de máquina,
  `--detailed-exit-code` para detectar drift (0 sin cambios, 2 con cambios). `apply --yes` salta la confirmación;
  los cambios destructivos exigen además `--confirm-destructive`. Hay GitHub Action oficial (`railwayapp/config@v1`)
  que comenta el plan en cada PR que toque `.railway/` y aplica al hacer merge (necesita un *project token* como
  secreto `RAILWAY_TOKEN`). **No se activa**: el `apply` requiere aprobación explícita del usuario y esa acción
  aplicaría al fusionar sin pasar por esa aprobación.
- **Pre-deploy**: corre en un contenedor aparte con acceso a las variables y a la red privada; si falla, no se
  reintenta y el deploy no avanza. Sin límite de tiempo por defecto; se puede acotar (1–3600 s) con
  `preDeployTimeoutSeconds` (campo de `DeployConfig`). Recomendado: `deploy: { preDeployTimeoutSeconds: 300 }`
  (pendiente de confirmar con `plan`).
- **Cron**: se declara como `deploy.cronSchedule`; cadencia mínima 5 min, **UTC**, y si la ejecución anterior sigue
  activa Railway **salta** la nueva. El proceso debe cerrar pool de Postgres y terminar (`process.exit`).
  `*/5 * * * *` es válido (también en el cambio de hora). Hay `railway cron list` / `railway cron run` para probar.
- **Postgres**: `postgres("Postgres")` compila a la imagen oficial `ghcr.io/railwayapp-templates/postgres-ssl:18`
  (etiqueta mayor, requisito de PITR). PITR: archivado continuo de WAL con pgBackRest a un bucket de Railway;
  base backup completo semanal + diferencial diario; ventana ≈ 4 semanas; **solo desde la activación** (no
  retroactivo); costo = almacenamiento del bucket + egress. La restauración crea un servicio nuevo y no toca el origen.
  `railway postgres pitr backup create --name pre-migration` y `schedule set --daily --weekly` existen tal cual.
  No fijar versión menor de la imagen (`:18.x`) con PITR activo.
- **PgBouncer**: `railway postgres pgbouncer add --pool-mode transaction` existe, pero no se usa en v1 (como en el prompt).
- **Acceso público**: la conexión de la app va por red privada. El TCP proxy solo en `development` si hace falta
  conectar desde local.

## AI SDK y modelo

- `ai@7` / `@ai-sdk/anthropic@4`: `tool({ description, inputSchema: z.object(...), execute })` sin cambios;
  `generateText({ model, system, messages, tools, stopWhen: isStepCount(8) })`. `maxSteps` no aparece en la doc.
  La doc usa Zod; la versión actual en npm es `zod@4.6.7`.
- `claude-sonnet-5-5` figura en la documentación del proveedor de Anthropic (id directo con guiones; el id del AI
  Gateway `anthropic/claude-sonnet-5.5` lleva punto y **no** se usa porque no usamos Gateway).
- Pendiente para la sesión del agente: confirmar que `temperature: 0.3` sigue aceptándose con Sonnet 5.5 en
  `@ai-sdk/anthropic@4` (no se pudo comprobar en la documentación leída).
- Si el equipo prefiere quedarse en AI SDK 6, hay que fijar la pareja de versiones compatible de `@ai-sdk/anthropic`
  (no verificada aquí).

## Better Auth

- Adaptador: la doc usa `import { drizzleAdapter } from "@better-auth/drizzle-adapter"`; el import `better-auth/adapters/drizzle` que usa `lib/auth.ts` sigue siendo válido (reexporta el paquete en `better-auth@1.7.14`). `drizzleAdapter(db, { provider: "pg", schema })`.
  Si las tablas de Better Auth se llaman `user`, `session`, `account`, `verification` (singular), no usar `usePlural`.
- Esquema: `pnpm dlx auth@latest generate`, copiar el resultado a `db/schema/auth.ts` y luego `drizzle-kit generate`.
- Route handler: `export const { GET, POST } = toNextJsHandler(auth);` (se pasa `auth`, no `auth.handler`).
- `nextCookies()` de `better-auth/next-js` debe ser **el último plugin**.
- `proxy.ts`: `export async function proxy(request)`, `getSessionCookie(request)` de `better-auth/cookies`: solo comprueba
  que existe la cookie, no es seguridad; la validación real va en servidor con `auth.api.getSession({ headers: await headers() })`.
- `databaseHooks.user.create.after(user)` recibe solo `user` (sin `ctx`). Con transacciones corre tras el commit.
  **Consecuencia**: crear organización + `profile` + `agent_configs` en ese hook ocurre *después* de crear el usuario;
  si falla, queda un usuario sin organización. Mitigación: función `ensureOrganization(userId)` idempotente que también
  se invoque al entrar a `/(app)` si el `profile` no existe (onboarding de reparación).

## Google Calendar / OAuth

- **FreeBusy**: `POST https://www.googleapis.com/calendar/v3/freeBusy` con `timeMin`, `timeMax` (RFC 3339), `timeZone`
  (por defecto UTC) e `items: [{ id }]`. Respuesta `calendars[id].busy[{start,end}]` (inicio inclusivo, fin exclusivo).
  Acepta los scopes `calendar`, `calendar.readonly`, `calendar.freebusy` y `calendar.events.freebusy`
  (**`calendar.events` no está en la lista**).
- **Scope**: el prompt pide `https://www.googleapis.com/auth/calendar`. Existen alternativas más estrechas
  (`calendar.events` + `calendar.freebusy`, y un scope de solo lectura de la lista de calendarios para elegir
  `calendar_id`). Decisión v1: mantener `calendar` (cubre FreeBusy, crear/editar eventos y listar calendarios con un solo
  consentimiento) y evaluar el recorte cuando se pase a verificación. La clasificación sensible/restringida del scope no
  se confirmó en las páginas leídas; consultar la página de scopes de Google antes de solicitar verificación.
- **Refresh token**: pedir `access_type=offline`, `prompt=consent` (para recibir siempre refresh token),
  `include_granted_scopes=true` y `state` firmado contra CSRF. Intercambio en `https://oauth2.googleapis.com/token`.
  Guardar el refresh token cifrado (AES-256-GCM).
- **Estado de publicación**: con la app en **Testing**, los refresh tokens caducan a los **7 días** (aplica a cualquier
  scope que no sea solo identidad). Para uso real hay que pasar la pantalla de consentimiento a **In production**
  (aparece aviso de "app no verificada" y tope de 100 usuarios hasta verificar). Un refresh token también deja de
  funcionar si el usuario revoca el acceso, no se usa en ~6 meses o se supera el límite de tokens por cliente/usuario.
  La app debe tratar `invalid_grant` marcando la integración como "desconectada" en `/integraciones`, nunca fallar en silencio.
- **Redirect URI** `${APP_URL}/api/auth/google/callback`: registrar el de `development`, el de `production` y el local
  (`http://localhost:3000/...`). La ruta vive bajo `/api/auth/`, donde Better Auth tiene el catch-all `[...all]`; en el
  App Router la ruta estática más específica gana, pero verificarlo con una prueba real.

## Pendiente de confirmar (no verificado)

1. `railway config plan` real: no hay CLI autenticado en este entorno (ver bloqueos en `docs/deploy-railway.md`).
2. Que `deploy.cronSchedule` aparezca en el plan para un servicio normal (compila y está en el tipo del SDK).
3. `preDeployTimeoutSeconds` y `backupSchedules` de volumen en IaC (están en los tipos del SDK; no documentados).
4. `temperature` con Sonnet 5.5 en `@ai-sdk/anthropic@4`.
5. Clasificación del scope `calendar` de Google (sensible vs restringido).
