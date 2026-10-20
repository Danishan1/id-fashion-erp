import { describe, it, expect } from "vitest";
import { checkSystemHealth } from "./platform-system-health.service";

describe("platform-system-health.service", () => {
  it("should return a comprehensive health report", async () => {
    const report = await checkSystemHealth();
    expect(report).toBeDefined();
    expect(report.timestamp).toBeDefined();
    expect(["HEALTHY", "WARNING", "CRITICAL"]).toContain(report.status);
    expect(report.database).toBeDefined();
    expect(["HEALTHY", "DEGRADED", "DOWN"]).toContain(report.database.status);
    expect(Array.isArray(report.queues)).toBe(true);
    expect(report.process).toBeDefined();
    expect(report.process.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(report.process.memory.rssMb).toBeGreaterThan(0);
  });
});
