import { prisma } from "@/core/db/client";
import { BULK_IMPORT_QUEUE_NAME } from "@/core/jobs/queue";
import { PLATFORM_JOBS_QUEUE_NAME } from "./platform-jobs.worker";
import IORedis from "ioredis";

export interface DatabaseHealth {
  status: "HEALTHY" | "DEGRADED" | "DOWN";
  latencyMs: number;
  totalCompanies: number;
  activeCompanies: number;
  totalUsers: number;
  totalSalesOrders: number;
  totalProductionOrders: number;
  totalAuditLogs: number;
  error?: string;
}

export interface QueueHealth {
  name: string;
  status: "ONLINE" | "OFFLINE" | "NOT_CONFIGURED";
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}

export interface ProcessMetrics {
  uptimeSeconds: number;
  nodeVersion: string;
  environment: string;
  platform: string;
  memory: {
    rssMb: number;
    heapTotalMb: number;
    heapUsedMb: number;
  };
}

export interface SystemHealthReport {
  timestamp: string;
  status: "HEALTHY" | "WARNING" | "CRITICAL";
  database: DatabaseHealth;
  queues: QueueHealth[];
  process: ProcessMetrics;
}

/** Diagnoses live database connectivity, latency, entity scale, queues, and server runtime metrics. */
export async function checkSystemHealth(): Promise<SystemHealthReport> {
  const timestamp = new Date().toISOString();

  // 1. Database Check
  let dbStatus: DatabaseHealth["status"] = "HEALTHY";
  let latencyMs = 0;
  let dbError: string | undefined;

  let totalCompanies = 0;
  let activeCompanies = 0;
  let totalUsers = 0;
  let totalSalesOrders = 0;
  let totalProductionOrders = 0;
  let totalAuditLogs = 0;

  try {
    const start = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    latencyMs = Math.round(performance.now() - start);

    [
      totalCompanies,
      activeCompanies,
      totalUsers,
      totalSalesOrders,
      totalProductionOrders,
      totalAuditLogs,
    ] = await Promise.all([
      prisma.company.count(),
      prisma.company.count({ where: { isActive: true } }),
      prisma.user.count({ where: { supportForPlatformUserId: null } }),
      prisma.salesOrder.count(),
      prisma.productionOrder.count(),
      prisma.auditLog.count(),
    ]);

    if (latencyMs > 500) {
      dbStatus = "DEGRADED";
    }
  } catch (err) {
    dbStatus = "DOWN";
    dbError = err instanceof Error ? err.message : "Database connection failed.";
  }

  // 2. Redis & Queues Check
  const queues: QueueHealth[] = [];
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    queues.push(
      { name: PLATFORM_JOBS_QUEUE_NAME, status: "NOT_CONFIGURED", waiting: 0, active: 0, completed: 0, failed: 0 },
      { name: BULK_IMPORT_QUEUE_NAME, status: "NOT_CONFIGURED", waiting: 0, active: 0, completed: 0, failed: 0 }
    );
  } else {
    try {
      const redis = new IORedis(redisUrl, {
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });

      await redis.connect();
      await redis.ping();

      // Helper to fetch BullMQ job counts from redis keys
      for (const queueName of [PLATFORM_JOBS_QUEUE_NAME, BULK_IMPORT_QUEUE_NAME]) {
        try {
          const [waiting, active, completed, failed] = await Promise.all([
            redis.llen(`bull:${queueName}:wait`),
            redis.llen(`bull:${queueName}:active`),
            redis.zcard(`bull:${queueName}:completed`),
            redis.zcard(`bull:${queueName}:failed`),
          ]);
          queues.push({
            name: queueName,
            status: "ONLINE",
            waiting: Number(waiting || 0),
            active: Number(active || 0),
            completed: Number(completed || 0),
            failed: Number(failed || 0),
          });
        } catch {
          queues.push({
            name: queueName,
            status: "OFFLINE",
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
          });
        }
      }

      await redis.quit();
    } catch {
      queues.push(
        { name: PLATFORM_JOBS_QUEUE_NAME, status: "OFFLINE", waiting: 0, active: 0, completed: 0, failed: 0 },
        { name: BULK_IMPORT_QUEUE_NAME, status: "OFFLINE", waiting: 0, active: 0, completed: 0, failed: 0 }
      );
    }
  }

  // 3. Process & Memory Metrics
  const mem = process.memoryUsage();
  const processMetrics: ProcessMetrics = {
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    environment: process.env.NODE_ENV ?? "development",
    platform: `${process.platform} (${process.arch})`,
    memory: {
      rssMb: Math.round(mem.rss / (1024 * 1024)),
      heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
      heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
    },
  };

  // Overall system evaluation
  let overallStatus: SystemHealthReport["status"] = "HEALTHY";
  if (dbStatus === "DOWN") {
    overallStatus = "CRITICAL";
  } else if (dbStatus === "DEGRADED" || queues.some((q) => q.status === "OFFLINE")) {
    overallStatus = "WARNING";
  }

  return {
    timestamp,
    status: overallStatus,
    database: {
      status: dbStatus,
      latencyMs,
      totalCompanies,
      activeCompanies,
      totalUsers,
      totalSalesOrders,
      totalProductionOrders,
      totalAuditLogs,
      error: dbError,
    },
    queues,
    process: processMetrics,
  };
}
