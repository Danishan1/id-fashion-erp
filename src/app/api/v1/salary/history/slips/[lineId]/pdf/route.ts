import type { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { getSalarySlipData } from "@/modules/hrms/salary-history.service";
import { renderSalarySlipPdf } from "@/modules/hrms/salary-slip-pdf";

export async function GET(req: NextRequest, { params }: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await params;
  const inline = req.nextUrl.searchParams.get("disposition") === "inline";
  return hrmsRoute("hrms_salary_history", "view", async (actor) => {
    const data = await getSalarySlipData(actor, lineId);
    const pdf = await renderSalarySlipPdf(data);
    const name = `Payslip-${data.employee.code}-${data.year}-${String(data.month).padStart(2, "0")}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(name)}"` },
    });
  });
}
