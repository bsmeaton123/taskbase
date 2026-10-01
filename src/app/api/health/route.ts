import { sql } from "drizzle-orm";
import { db } from "@/db";

/** Liveness + database check for load balancers and uptime monitors. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "database unavailable" }, { status: 503 });
  }
}
