import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { getRunForExport } from "@/modules/hrms/salary-history.service";
import { buildSalaryReportXlsx } from "@/modules/hrms/salary-report-xlsx";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return hrmsRoute("hrms_salary_history", "export", async (actor) => {
    const run = await getRunForExport(actor, runId);
    const buffer = await buildSalaryReportXlsx(run);
    const name = `Salary-${run.year}-${String(run.month).padStart(2, "0")}.xlsx`;
    return new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}"` },
    });
  });
}
