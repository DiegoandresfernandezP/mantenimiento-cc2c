# Mantenimiento CC2C (CMMS · fase 2)

Aplicación para gestionar el mantenimiento de **EQ-001 · ELEGOO Centauri Carbon 2 Combo** (Moldevivo / ETITC, Bogotá).
Deriva de la *Guía de Gestión de Mantenimiento GM-CC2C-001*. Cloudflare Worker + D1 + Telegram para avisos.

## Qué incluye (v0.1)
Inicio con vencidos/próximos · FOR-001 inspección diaria · FOR-002 encendido/apagado y tiempo de impresión (con alertas) ·
FOR-003 ejecución de actividades (ACT-001…020) · FOR-004 fallas · FOR-005 órdenes de trabajo · FOR-006 repuestos ·
indicadores IND-01…08 · historial · QR estables `/qr/QR-0xx` (el destino se cambia sin reimprimir etiquetas).

## Despliegue
1. Cloudflare → Workers & Pages → Create → **Import a repository** → este repo. Rama principal, comando de deploy por defecto (`npx wrangler deploy`).
2. La base `cc2c-cmms` (D1) ya está enlazada en `wrangler.jsonc`.
3. Secretos (Settings → Variables and Secrets → tipo *Secret*):
   - `SETUP_CODE`: código que permite crear el PIN en el primer ingreso de cada usuario.
   - `TELEGRAM_BOT_TOKEN`: token de @BotFather.
   - `TELEGRAM_WEBHOOK_SECRET`: cadena larga aleatoria (30+ caracteres).
4. Abrir **una vez** `https://<tu-worker>.workers.dev/admin/telegram-setup?key=<TELEGRAM_WEBHOOK_SECRET>` para registrar el webhook.
5. Cada persona escribe `/start` al bot para recibir avisos (`/estado`, `/baja`).
6. Aviso diario automático a las 07:00 (Bogotá) si hay vencidos, próximos, fallas, OT o repuestos pendientes.

## Base de datos
`db/schema.sql` y `db/seed.sql` (sin PIN ni secretos). Reaplicar: `npm run db:schema && npm run db:seed`.

## Pendientes heredados de la guía
Frecuencias marcadas PROPUESTA sin validar; lubricante e intervalos sin guía oficial del CC2; videos de QR sin verificar acceso/canal;
número de serie y día de compra. No guardar contraseñas, tokens ni PIN en este repositorio.
