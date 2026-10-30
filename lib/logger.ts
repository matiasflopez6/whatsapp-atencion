/** Logs estructurados (una línea JSON) para que Railway los indexe. Nunca registres tokens ni mensajes completos. */
type Fields = Record<string, unknown>;

function emit(level: "debug" | "info" | "warn" | "error", msg: string, fields?: Fields): void {
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** +5218112345678 → ••••5678 (los teléfonos son datos personales). */
export function maskPhone(phone: string): string {
  return phone.length <= 4 ? "••••" : `••••${phone.slice(-4)}`;
}
