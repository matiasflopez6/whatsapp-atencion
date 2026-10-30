/**
 * Cron `cron-reprocess` (Railway, cada 5 min, UTC): recoge los webhook_events que after() no llegó a
 * procesar (redeploy/SIGTERM) o que fallaron, y los reprocesa. Reclama con FOR UPDATE SKIP LOCKED
 * (lib/db/system.ts), procesa en serie y TERMINA el proceso: si no, Railway saltaría la siguiente ejecución.
 */
import { closePool } from "@/lib/db";
import { claimWebhookEventsForReprocess, releaseWebhookEvents } from "@/lib/db/system";
import { errorMessage, log } from "@/lib/logger";
import { processWebhookEvent } from "@/lib/whatsapp/process";

const BATCH_SIZE = 25;
const TIME_BUDGET_MS = 4 * 60 * 1000; // por debajo de los 5 min entre ejecuciones

async function main(): Promise<void> {
  const started = Date.now();
  const claimed = await claimWebhookEventsForReprocess(BATCH_SIZE);
  log.info("cron reprocess: eventos reclamados", { count: claimed.length });

  let processed = 0;
  for (const event of claimed) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      // Devuelve lo que no dio tiempo a procesar para que la siguiente ejecución lo reclame.
      const rest = claimed.slice(processed);
      log.warn("cron reprocess: presupuesto de tiempo agotado", { remaining: rest.length });
      await releaseWebhookEvents(rest.map((e) => e.id));
      break;
    }
    await processWebhookEvent(event, { alreadyClaimed: true });
    processed++;
  }
  log.info("cron reprocess: terminado", { processed, ms: Date.now() - started });
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (error) => {
    log.error("cron reprocess: error fatal", { error: errorMessage(error) });
    await closePool().catch(() => undefined);
    process.exit(1);
  });
