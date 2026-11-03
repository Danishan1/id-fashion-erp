import { describe, expect, it, vi } from "vitest";

const take = vi.hoisted(() => vi.fn(async () => ({ created: 2 })));
vi.mock("bullmq", () => ({ Queue: vi.fn(), Worker: vi.fn() }));
vi.mock("@/core/jobs/queue", () => ({ createRedisConnection: vi.fn(), databaseScopedQueueName: (n: string) => `test:${n}` }));
vi.mock("./forecast-snapshot.service", () => ({ takeAutoSnapshotsForAllCompanies: take }));

const { handleForecastJob, FORECAST_JOBS_QUEUE_NAME } = await import("./forecast-jobs.worker");

describe("forecast background job", () => {
  it("takes the automatic snapshots; unknown jobs fail loudly", async () => {
    expect(FORECAST_JOBS_QUEUE_NAME).toBe("test:sales-forecast");
    await expect(handleForecastJob({ name: "forecast.auto-snapshots" })).resolves.toEqual({ created: 2 });
    expect(take).toHaveBeenCalledTimes(1);
    await expect(handleForecastJob({ name: "nope" })).rejects.toThrow(/Unknown forecast job/);
  });
});
