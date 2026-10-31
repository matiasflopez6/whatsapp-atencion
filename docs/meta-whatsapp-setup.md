# Configurar Meta (WhatsApp Cloud API)

Antes de seguir, comprobar la versión vigente de Graph API en
<https://developers.facebook.com/docs/graph-api/changelog/versions> (el 2026-10-30 es `v26.0`). La constante vive en
`GRAPH_API_VERSION`.

## 1. App y permisos

1. <https://developers.facebook.com/apps> → *Crear app* → tipo **Business**.
2. Añadir el producto **WhatsApp**. Se crea (o se vincula) una *WhatsApp Business Account* (WABA).
3. *Configuración de la app → Básica*: copiar el **App Secret** (se guarda por organización en `/integraciones`,
   cifrado; **no** como variable de entorno).
4. Número: en *WhatsApp → Configuración de la API* hay un número de prueba (hasta 5 destinatarios verificados).
   Para uso real, añadir y verificar el número de la clínica en la WABA.
5. Copiar **Phone number ID** y **WhatsApp Business Account ID**.

## 2. Token de acceso permanente

Los tokens temporales caducan a las 24 h; usar un **System User**:

1. *Business Settings → Users → System users* → crear usuario **Admin** de sistema.
2. Asignarle la app (control total) y la WABA.
3. *Generate new token* con la app, expiración **Never** y permisos
   `whatsapp_business_messaging` y `whatsapp_business_management`.
4. Pegar el token en `/integraciones` (se cifra con AES-256-GCM antes de guardarse).

## 3. Webhook

1. URL de devolución de llamada: `https://<dominio-de-web>/api/webhooks/whatsapp` (la muestra `/integraciones`;
   debe ser HTTPS con certificado válido, vale `*.up.railway.app`).
2. Token de verificación: el que genera/muestra `/integraciones` (formato `{org_slug}:{secreto}`).
3. *Verificar y guardar*. Meta hace `GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`; la app responde 200 con el
   `hub.challenge` si el token coincide con una organización.
4. Suscribir el campo **`messages`** de la WABA.
5. Cada app de Meta firma los POST con `X-Hub-Signature-256` (HMAC-SHA256 del body crudo con el App Secret).

Prueba rápida: desde *WhatsApp → Configuración de la API* enviar el mensaje de prueba al número de destino y, desde ese
teléfono, responder; debe aparecer una fila en `webhook_events` y un mensaje en `/conversaciones`.

## 4. Nota sobre mTLS

Meta puede presentar un certificado de cliente al llamar al webhook (CN `client.webhooks.fbclientcerts.com`), firmado por
la CA `meta-outbound-api-ca-2025-12.pem`; reemplaza al certificado de DigiCert, que expiró el 2026-04-15.

- En Railway el TLS termina en el edge y la app **no valida certificados de cliente**: no hay que configurar nada y el
  cambio de CA no afecta. La autenticidad se garantiza con la firma HMAC.
- Si se añade en el futuro un proxy propio con validación mTLS (`ssl_verify_client on` en nginx, ALB, etc.), debe confiar
  en `meta-outbound-api-ca-2025-12.pem` y comprobar el CN. Activarlo/desactivarlo en Meta es por aplicación, no por número.
- Revisar la doc de Meta (<https://developers.facebook.com/docs/graph-api/webhooks/getting-started>) antes de cada deploy
  a producción.

## 5. Reintentos y límites

- Si el POST no recibe 200, Meta reintenta inmediatamente y después con frecuencia decreciente hasta **7 días**
  (la doc genérica de Graph indica 36 h): la app deduplica por `wa_message_id` (`webhook_events.wa_message_id` único).
- Un POST puede traer hasta 1000 actualizaciones: procesar todas las `entry[].changes[]`.
- Los mensajes de estado (`statuses`) llegan por el mismo webhook; v1 los ignora sin error.
- La ventana de servicio de 24 h aplica a mensajes libres: fuera de ella solo se pueden enviar plantillas aprobadas.

## Qué carga el usuario y dónde

| Dato | Dónde |
|---|---|
| Phone number ID, WABA ID, Access token (System User), App Secret | `/integraciones` (por organización, cifrado en BD) |
| Verify token | Lo genera la app; se copia en el panel de Meta |
