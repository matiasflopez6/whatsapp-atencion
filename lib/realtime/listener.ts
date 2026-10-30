import { Client } from "pg";
import { errorMessage, log } from "@/lib/logger";
import { REALTIME_EVENT_TYPES, type RealtimeEvent, type RealtimeEventType } from "./types";

/**
 * Un único cliente `pg` dedicado por proceso que hace `LISTEN org_events` y reparte cada
 * notificación a los suscriptores de SU organización. Los triggers de la base (0002, 0004) emiten
 * solo IDs. No usa el pool: LISTEN necesita una conexión de sesión, no una de transacción
 * (con PgBouncer en modo transaction habría que apuntar `DATABASE_URL` directo a Postgres).
 *
 * El aislamiento entre negocios está en `subscribe(organizationId, …)`: el `organizationId` sale de
 * la sesión (ver app/api/realtime/route.ts) y un suscriptor solo recibe eventos de esa organización.
 */
export const REALTIME_CHANNEL = "org_events";

export type RealtimeMessage = RealtimeEvent | { type: "resync" };
type Handler = (event: RealtimeMessage) => void;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PING_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

type Parsed = { organizationId: string; event: RealtimeEvent };

/** Valida el payload del NOTIFY; descarta lo que no tenga la forma esperada. */
export function parseNotification(payload: string | undefined): Parsed | null {
  if (!payload) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const type = p.type;
  if (typeof type !== "string" || !(REALTIME_EVENT_TYPES as readonly string[]).includes(type)) return null;
  if (typeof p.organization_id !== "string" || !UUID_RE.test(p.organization_id)) return null;
  if (typeof p.id !== "string" || !UUID_RE.test(p.id)) return null;
  const event: RealtimeEvent = { type: type as RealtimeEventType, id: p.id };
  if (typeof p.conversation_id === "string" && UUID_RE.test(p.conversation_id)) event.conversationId = p.conversation_id;
  return { organizationId: p.organization_id, event };
}

export class RealtimeListener {
  private readonly subscribers = new Map<string, Set<Handler>>();
  private client: Client | null = null;
  private starting = false;
  private attempt = 0;
  private timer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private connectedOnce = false;

  constructor(private readonly connectionString: () => string | undefined = () => process.env.DATABASE_URL) {}

  /** Registra un manejador para una organización. Devuelve la función que lo da de baja. */
  subscribe(organizationId: string, handler: Handler): () => void {
    let handlers = this.subscribers.get(organizationId);
    if (!handlers) this.subscribers.set(organizationId, (handlers = new Set()));
    handlers.add(handler);
    this.ensureConnected();
    return () => {
      const set = this.subscribers.get(organizationId);
      set?.delete(handler);
      if (set && set.size === 0) this.subscribers.delete(organizationId);
    };
  }

  get subscriberCount(): number {
    let n = 0;
    for (const set of this.subscribers.values()) n += set.size;
    return n;
  }

  private ensureConnected(): void {
    if (this.client || this.starting || this.timer) return;
    void this.connect();
  }

  private async connect(): Promise<void> {
    const url = this.connectionString();
    if (!url) {
      log.error("realtime: DATABASE_URL no está definida");
      return;
    }
    this.starting = true;
    const client = new Client({ connectionString: url, keepAlive: true });
    try {
      client.on("notification", (msg) => {
        if (msg.channel === REALTIME_CHANNEL) this.dispatch(msg.payload);
      });
      // 'error' y 'end' pueden dispararse ambos: scheduleReconnect es idempotente.
      client.on("error", (error) => this.lost(client, error));
      client.on("end", () => this.lost(client, new Error("conexión cerrada")));
      await client.connect();
      await client.query(`LISTEN ${REALTIME_CHANNEL}`);
      this.client = client;
      this.starting = false;
      const reconnected = this.connectedOnce;
      this.connectedOnce = true;
      this.attempt = 0;
      this.startPing(client);
      log.info("realtime: escuchando", { channel: REALTIME_CHANNEL, reconnected });
      // Tras una reconexión pudieron perderse notificaciones: los clientes refrescan sus datos.
      if (reconnected) this.broadcast({ type: "resync" });
    } catch (error) {
      this.starting = false;
      this.lost(client, error);
    }
  }

  private lost(client: Client, error: unknown): void {
    if (this.client && this.client !== client) return; // evento de un cliente ya reemplazado
    this.client = null;
    this.starting = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    client.removeAllListeners();
    client.on("error", () => undefined); // evita 'error' sin manejador mientras se cierra
    void client.end().catch(() => undefined);
    if (this.timer) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt++);
    log.warn("realtime: conexión perdida, reintentando", { delayMs: delay, error: errorMessage(error) });
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.subscriberCount > 0) void this.connect();
    }, delay);
    this.timer.unref?.();
  }

  private startPing(client: Client): void {
    this.pingTimer = setInterval(() => {
      client.query("SELECT 1").catch((error) => this.lost(client, error));
    }, PING_MS);
    this.pingTimer.unref?.();
  }

  private dispatch(payload: string | undefined): void {
    const parsed = parseNotification(payload);
    if (!parsed) return;
    const handlers = this.subscribers.get(parsed.organizationId);
    if (!handlers) return;
    for (const handler of [...handlers]) this.safe(handler, parsed.event);
  }

  private broadcast(event: RealtimeMessage): void {
    for (const handlers of this.subscribers.values()) for (const handler of [...handlers]) this.safe(handler, event);
  }

  private safe(handler: Handler, event: RealtimeMessage): void {
    try {
      handler(event);
    } catch (error) {
      log.error("realtime: manejador falló", { error: errorMessage(error) });
    }
  }

  /** Cierra la conexión y cancela reintentos (tests). */
  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.subscribers.clear();
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners();
      client.on("error", () => undefined);
      await client.end().catch(() => undefined);
    }
  }
}

// Singleton por proceso (sobrevive al hot reload y a los bundles separados de Next).
const globalForRealtime = globalThis as unknown as { __realtimeListener?: RealtimeListener };
export const realtimeListener: RealtimeListener = (globalForRealtime.__realtimeListener ??= new RealtimeListener());
