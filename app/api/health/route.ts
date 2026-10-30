import { NextResponse } from "next/server";
import { pingDatabase } from "@/lib/db/system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Healthcheck de Railway: confirma que el proceso responde y que Postgres es alcanzable.
export async function GET() {
  try {
    await pingDatabase();
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error(
      JSON.stringify({ level: "error", msg: "healthcheck failed", error: error instanceof Error ? error.message : String(error) }),
    );
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
