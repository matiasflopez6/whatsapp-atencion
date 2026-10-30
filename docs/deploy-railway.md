# Deploy en Railway

Todo corre en un único proyecto de Railway: `web` (Next.js standalone), `cron-reprocess` (job cada 5 min) y
`Postgres` (Railway PostgreSQL, solo red privada). La infraestructura está en [`.railway/railway.ts`](../.railway/railway.ts).
Decisiones y versiones verificadas: [decisions.md](./decisions.md).

## Requisitos

- Railway CLI **≥ 5.42.1** (`npm i -g @railway/cli` o `brew install railway`) y `railway login`.
- El SDK de IaC como dependencia de desarrollo: `pnpm add -D railway` (ya está en `package.json`).
- Acceso de la app de GitHub de Railway al repositorio `matiasflopez6/whatsapp-atencion`.
- No debe existir `railway.json` ni `railway.toml` en el repo (dejan de leerse el 2026-12-01).

## Variables

### Compartidas del entorno (se cargan a mano, una vez por entorno: `production` y `development`)

Railway → Project → *Settings → Shared Variables* (seleccionar el entorno). Deben existir **antes** del primer `apply`.

| Variable | Obligatoria | Cómo obtenerla |
|---|---|---|
| `ENCRYPTION_KEY` | Sí | `openssl rand -base64 32` (32 bytes). **Distinta por entorno y no rotar sin migrar los datos cifrados.** |
| `BETTER_AUTH_SECRET` | Sí | `openssl rand -base64 32` (mínimo 32 caracteres) |
| `ANTHROPIC_API_KEY` | Sí | console.anthropic.com → API keys |
| `GOOGLE_CLIENT_ID` | Sí | Google Cloud Console (ver [google-oauth.md](./google-oauth.md)) |
| `GOOGLE_CLIENT_SECRET` | Sí | Idem |
| `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM` | No | Solo si se activan magic link / reseteo. Hasta entonces siguen comentadas en `railway.ts`. |

### Declaradas en `railway.ts` (no se tocan a mano)

`DATABASE_URL` (referencia a `Postgres`, red privada), `HOSTNAME=0.0.0.0` y las referencias `ctx.shared.*`.
`PORT` y `RAILWAY_PUBLIC_DOMAIN` los inyecta Railway. `APP_URL` solo si se usa dominio propio.
`DATABASE_PUBLIC_URL` no se usa en producción (pasa por el TCP proxy y factura egress).

## Primer deploy (pasos)

1. **Crear el proyecto** `whatsapp-atencion` con los entornos `production` y `development` (cada uno con su propio Postgres)
   y vincular el directorio: `railway link`.
2. **Cargar las variables compartidas** de la tabla anterior en cada entorno.
3. **Plan**: `railway config plan` (con el entorno elegido). Debe mostrar solo la creación de `Postgres`, `web` y
   `cron-reprocess`. Los valores salen ocultos (`«hidden»`); `--show-values` solo para revisar configuración no secreta.
   - Si falla con "managed by railway.json/toml", eliminar esos archivos.
   - Si una referencia compartida no existe, cargarla antes de seguir.
4. **Aprobación**: el plan se revisa con el dueño del proyecto. `railway config apply` **solo tras aprobación explícita**
   de ese plan; cualquier cambio marcado como destructivo requiere además `--confirm-destructive` y nueva aprobación.
5. **Apply**: `railway config apply`. Se dispara el build de `web`; el pre-deploy ejecuta `pnpm db:migrate` y, si falla,
   el deploy no avanza (se ve en los logs de build/deploy).
6. **Verificar** el despliegue concreto: `railway deployment list --service web --json`. Solo cuenta como exitoso el
   deployment en estado **`SUCCESS`**. Ante `FAILED`/`CRASHED`: `railway logs --service web --lines 200 --json`
   antes de reintentar.
7. **Dominio público** de `web`: `railway domain --service web` (o `domains: [...]` en `railway.ts` para dominio propio;
   el dominio `*.up.railway.app` generado no se escribe en el archivo). Comprobar `https://<dominio>/api/health` → 200.
8. **Meta**: configurar la URL del webhook con ese dominio ([meta-whatsapp-setup.md](./meta-whatsapp-setup.md)).
9. **Google**: añadir `https://<dominio>/api/auth/google/callback` como URI de redirección autorizada
   ([google-oauth.md](./google-oauth.md)).
10. **Backups de producción** (ver abajo).
11. **Convergencia**: `railway config plan --detailed-exit-code` debe salir con `0` ("already up to date").

## Servicios

| Servicio | Build | Pre-deploy | Start | Extra |
|---|---|---|---|---|
| `web` | `pnpm build` (`next build` + copia de `public` y `.next/static` a `.next/standalone`) | `pnpm db:migrate` | `node .next/standalone/server.js` | healthcheck `/api/health`, escucha `0.0.0.0:$PORT` |
| `cron-reprocess` | `pnpm build:scripts` | — | `pnpm cron:reprocess` | `cronSchedule: */5 * * * *` (UTC, mínimo 5 min) |
| `Postgres` | imagen oficial `postgres-ssl:18` | — | — | solo red privada |

- **Cron**: el proceso debe cerrar el pool de `pg` y terminar. Si una ejecución sigue `Active` cuando toca la siguiente,
  Railway la salta, por eso `scripts/reprocess-webhooks.ts` debe acotar su duración y salir siempre (también ante error).
  Probar a mano: `railway cron run --service cron-reprocess`; historial: `railway cron list`.
- Si Railpack detecta mal Node, fijar `RAILPACK_NODE_VERSION` en las variables del servicio.
- Migraciones: el pre-deploy corre en un contenedor aparte; no depende de volúmenes ni de la app arrancada.
  Fijar un tope con `preDeployTimeoutSeconds` evita que una migración colgada bloquee el deploy.

## Backups, PITR y restauración (Postgres de `production`)

Requisitos: imagen oficial de Railway con etiqueta **mayor** (`postgres-ssl:18`, no `:18.x`) y sin start command
personalizado. Coste: almacenamiento del bucket + egress de los envíos (sin tarifa propia de PITR).

```bash
# Activar archivado continuo (crea el bucket Postgres-PITR y redeploya Postgres)
railway postgres pitr enable --service Postgres --environment production
railway postgres pitr status --service Postgres --environment production

# Backups de volumen programados
railway postgres pitr schedule set --daily --weekly --service Postgres --environment production
railway postgres pitr schedule list --service Postgres --environment production

# Antes de una migración riesgosa
railway postgres pitr backup create --name pre-migration --service Postgres --environment production
```

- La ventana de restauración empieza en el primer base backup tras activar PITR (no es retroactiva) y cubre ≈ 4 semanas.
- **Restaurar a un instante** crea un servicio **nuevo** (`Postgres-restored-YYYYMMDD-HHMM`); el original no se toca:
  ```bash
  railway postgres pitr restore --service Postgres --environment production \
    --at 2026-11-20T12:00:00Z --new-service-name Postgres-restored
  ```
  Después hay que cambiar `DATABASE_URL` a mano (o copiar las filas necesarias). **No** usar
  `railway postgres pitr backup restore <ID>` salvo que se quiera sobrescribir el Postgres actual: es un restore en sitio
  y requiere aprobación explícita.
- **IaC y recursos creados por PITR**: el bucket `Postgres-PITR` y los servicios `*-restored-*` no están en
  `railway.ts`; el siguiente `railway config plan` puede mostrarlos como borrados. No aplicar a ciegas: revisar el plan,
  declarar el bucket en el archivo o decidir conscientemente qué se elimina.
- Verificar cada trimestre con una restauración de prueba a un servicio nuevo en `development`/proyecto temporal.

## Acceso a la base desde local

En `development`, si hace falta conectar desde la máquina local, habilitar el TCP proxy del servicio `Postgres` de ese
entorno y usar `DATABASE_PUBLIC_URL` en `.env.local`. En `production` no hay acceso público.

## Pre-deploy checklist (cada release)

- [ ] `pnpm typecheck && pnpm lint && pnpm build`
- [ ] Migraciones nuevas revisadas; si son riesgosas: backup con nombre.
- [ ] `GRAPH_API_VERSION` sigue vigente (changelog de Graph API).
- [ ] `railway config plan --detailed-exit-code` solo muestra los cambios esperados.
- [ ] Tras el deploy: deployment en `SUCCESS`, `/api/health` 200, logs sin errores.
