import { createHmac, timingSafeEqual } from "node:crypto";

/** Valida `X-Hub-Signature-256` (`sha256=<hex>`): HMAC-SHA256 del body CRUDO con el App Secret. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function signBody(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}
