# Configurar Google Calendar (OAuth 2.0)

El OAuth de Calendar es independiente del login de la app (Better Auth usa email + contraseña). Cada organización conecta
su propio calendario; el `refresh_token` se guarda cifrado (AES-256-GCM) en `google_calendar_configs`.

## 1. Proyecto y credenciales

1. <https://console.cloud.google.com> → crear proyecto → habilitar **Google Calendar API**.
2. *APIs y servicios → Pantalla de consentimiento OAuth*: tipo **Externo**, nombre de la app, correo de soporte,
   política de privacidad (URL pública) y el scope `https://www.googleapis.com/auth/calendar`.
3. *Credenciales → Crear ID de cliente OAuth* → tipo **Aplicación web**. URIs de redirección autorizadas:
   - `http://localhost:3000/api/auth/google/callback`
   - `https://<dominio-development>/api/auth/google/callback`
   - `https://<dominio-production>/api/auth/google/callback`
4. Copiar `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` (variables compartidas de Railway; `.env.local` en local).

## 2. Estado de publicación (importante)

| Estado | Efecto |
|---|---|
| **Testing** | Solo usuarios de prueba (máx. 100). **Los refresh tokens caducan a los 7 días** → el agente dejaría de ver el calendario cada semana. Solo para desarrollo. |
| **In production** (sin verificar) | Sin caducidad de 7 días, pero aviso de "aplicación no verificada" y tope de 100 usuarios. Válido para el primer cliente. |
| **In production** (verificada) | Sin aviso ni tope. Requiere el proceso de verificación de Google para los scopes sensibles. |

Para la clínica piloto: pasar a *In production* antes de conectarla. Comprobar en la página de scopes de Google cómo se
clasifica `calendar` antes de pedir verificación.

## 3. Flujo implementado

1. `/integraciones` → «Conectar con Google» → redirección a `https://accounts.google.com/o/oauth2/v2/auth` con
   `client_id`, `redirect_uri=${appUrl}/api/auth/google/callback`, `response_type=code`,
   `scope=https://www.googleapis.com/auth/calendar`, `access_type=offline`, `prompt=consent`,
   `include_granted_scopes=true` y `state` firmado (organización + nonce en cookie `httpOnly`) contra CSRF.
2. Callback: validar `state`, cambiar `code` por tokens en `https://oauth2.googleapis.com/token` y guardar
   `refresh_token` cifrado. La organización se toma de la sesión de Better Auth, nunca de la query.
3. Listar calendarios y dejar elegir `calendar_id`.
4. FreeBusy: `POST https://www.googleapis.com/calendar/v3/freeBusy` con `timeMin`, `timeMax`, `timeZone` e `items`.
   `busy[].end` es exclusivo.
5. Si Google responde `invalid_grant` (token revocado/caducado): marcar la integración como desconectada y avisar en el
   panel. El agente **no ofrece horarios** sin FreeBusy real.

## Qué carga el usuario y dónde

| Dato | Dónde |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Variables compartidas de Railway (por entorno) y `.env.local` |
| Cuenta de Google y calendario del negocio | Botón en `/integraciones` (cada organización) |
