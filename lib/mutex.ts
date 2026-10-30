/**
 * Exclusión mutua EN PROCESO por clave (un hilo de ejecución por conversación, una reserva a la vez
 * por organización). Railway corre una instancia de `web`; si algún día hubiera varias, la defensa
 * entre instancias son las comprobaciones idempotentes de lib/whatsapp/process.ts y la reserva.
 */
const tails = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}
