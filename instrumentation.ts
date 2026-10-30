export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("@/lib/env");
    getEnv(); // falla rápido al arrancar si falta una variable obligatoria
  }
}
