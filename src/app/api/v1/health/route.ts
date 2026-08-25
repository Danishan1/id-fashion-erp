import { NextResponse } from "next/server";
import { prisma } from "@/core/db/client";

/**
 * Deliberately unauthenticated and minimal-information — load balancers,
 * container orchestrators, and uptime monitors need to probe this without a
 * session cookie, and it should never leak anything beyond up/down status
 * (no stack traces, no config values, no query results). A previously
 * completely absent endpoint, flagged by the readiness audit
 * (FASHION_ERP_COMPLETE_READINESS_AUDIT.md, Phase D) as a real deploy
 * blocker for any container/orchestrator-based deployment.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "ok", timestamp: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "error", database: "unreachable", timestamp: new Date().toISOString() }, { status: 503 });
  }
}
