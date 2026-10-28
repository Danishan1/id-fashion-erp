import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { rupeesInWords } from "@/lib/amount-in-words";
import type { SalarySlipData } from "./salary-history.service";

/**
 * Salary slip (Salary Management slice 4, 2026-10-28), laid out like the
 * reference project's payslip: header, employee grid, earnings (rate vs
 * earned) and deductions side by side, net in words. Built only from the
 * stored, finalised line — nothing is recalculated.
 */

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8.5, fontFamily: "Helvetica", color: "#222" },
  company: { fontSize: 14, fontWeight: 700, textAlign: "center" },
  address: { fontSize: 7.5, color: "#555", textAlign: "center", marginTop: 2 },
  title: { fontSize: 10, fontWeight: 700, textAlign: "center", marginTop: 8, marginBottom: 8, letterSpacing: 0.5 },
  grid: { flexDirection: "row", flexWrap: "wrap", borderWidth: 0.75, borderColor: "#999" },
  cell: { width: "50%", flexDirection: "row", paddingVertical: 3, paddingHorizontal: 5, borderBottomWidth: 0.5, borderColor: "#ccc" },
  label: { width: "45%", color: "#555" },
  value: { width: "55%", fontWeight: 700 },
  tables: { flexDirection: "row", marginTop: 10, borderWidth: 0.75, borderColor: "#999" },
  half: { width: "50%" },
  head: { flexDirection: "row", backgroundColor: "#eee", paddingVertical: 4, paddingHorizontal: 5, fontWeight: 700 },
  row: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 5, borderBottomWidth: 0.5, borderColor: "#e5e5e5" },
  total: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 5, fontWeight: 700, borderTopWidth: 0.75, borderColor: "#999" },
  c1: { width: "50%" },
  c2: { width: "25%", textAlign: "right" },
  c3: { width: "25%", textAlign: "right" },
  d1: { width: "65%" },
  d2: { width: "35%", textAlign: "right" },
  net: { marginTop: 10, borderWidth: 0.75, borderColor: "#999", padding: 6 },
  netLine: { flexDirection: "row", justifyContent: "space-between", fontSize: 11, fontWeight: 700 },
  words: { marginTop: 3, color: "#444" },
  note: { marginTop: 8, fontSize: 7, color: "#666" },
  signs: { flexDirection: "row", justifyContent: "space-between", marginTop: 40, fontSize: 8 },
});

const inr = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const maskAccount = (v: string | null) => (v ? `XXXX${v.slice(-4)}` : "—");

function SlipDocument({ d }: { d: SalarySlipData }) {
  const a = d.amounts;
  const monthName = new Date(Date.UTC(d.year, d.month - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase();
  const allowances = a.earnedComponents.filter((c) => c.kind === "ALLOWANCE");
  // Overtime is part of gross and is prorated with it; whatever is left of earned gross after basic and allowances.
  const overtimeEarned = Math.max(0, Math.round((a.earnedGross - a.earnedBase - allowances.reduce((t, c) => t + c.amount, 0)) * 100) / 100);
  const earnings: [string, number | null, number][] = [
    ["Basic", d.setup.baseMonthlySalary, a.earnedBase],
    ...allowances.map((c) => [c.title, c.rate, c.amount] as [string, number, number]),
    ...(a.overtimePay > 0 || overtimeEarned > 0 ? ([["Overtime", a.overtimePay, overtimeEarned]] as [string, number, number][]) : []),
    ...(a.arrears !== 0 ? ([[`Arrears${d.arrearsReason ? ` (${d.arrearsReason})` : ""}`, null, a.arrears]] as [string, null, number][]) : []),
  ];
  const deductions: [string, number][] = (
    [
      ["Provident Fund", a.pf],
      ["ESIC", a.esic],
      ...a.earnedComponents.filter((c) => c.kind === "DEDUCTION").map((c) => [c.title, c.amount] as [string, number]),
      ["Loan / Salary Advance", a.installment],
      ["TDS", a.tds],
      ["Surcharge", a.surcharge],
      ["Education Cess", a.educationCess],
      ["Interest on Late Fees", a.lateFeeInterest],
    ] as [string, number][]
  ).filter(([, v]) => v !== 0);
  const earnedTotal = Math.round((a.earnedGross + a.arrears) * 100) / 100;

  const info: [string, string][] = [
    ["Employee Name", d.employee.name],
    ["Employee Code", d.employee.code],
    ["Designation", d.employee.designation ?? "—"],
    ["Department", d.employee.department ?? "—"],
    ["Date of Joining", date(d.employee.joinDate)],
    ["PAN", d.employee.pan ?? "—"],
    ["PF UAN", d.employee.uan ?? "—"],
    ["ESIC No.", d.employee.esicNumber ?? "—"],
    ["Days in Month", String(d.days.calendar)],
    ["Paid Days", String(d.days.paid)],
    ["Present", String(d.days.present)],
    ["Weekly Offs + Holidays", String(d.days.weekend + d.days.holiday)],
    ["Paid Leave", String(d.days.paidLeave)],
    ["Absent + Unpaid", String(d.days.unpaidAndAbsent)],
    ["Extra Days / OT Hours", `${d.days.extra} / ${d.days.overtimeHours}`],
    ["Bank", d.employee.bankName ? `${d.employee.bankName} ${maskAccount(d.employee.bankAccount)}` : "—"],
  ];

  return (
    <Document title={`Payslip ${d.employee.code} ${monthName}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.company}>{d.company.name}</Text>
        {d.company.address ? <Text style={s.address}>{d.company.address}</Text> : null}
        <Text style={s.title}>PAYSLIP FOR THE MONTH OF {monthName}</Text>

        <View style={s.grid}>
          {info.map(([k, v]) => (
            <View key={k} style={s.cell}>
              <Text style={s.label}>{k}</Text>
              <Text style={s.value}>{v}</Text>
            </View>
          ))}
        </View>

        <View style={s.tables}>
          <View style={[s.half, { borderRightWidth: 0.75, borderColor: "#999" }]}>
            <View style={s.head}>
              <Text style={s.c1}>Earnings</Text>
              <Text style={s.c2}>Rate</Text>
              <Text style={s.c3}>Earned</Text>
            </View>
            {earnings.map(([k, rate, v]) => (
              <View key={k} style={s.row}>
                <Text style={s.c1}>{k}</Text>
                <Text style={s.c2}>{rate === null ? "" : inr(rate)}</Text>
                <Text style={s.c3}>{inr(v)}</Text>
              </View>
            ))}
            <View style={s.total}>
              <Text style={s.c1}>Total Earnings</Text>
              <Text style={s.c2}>{inr(a.gross)}</Text>
              <Text style={s.c3}>{inr(earnedTotal)}</Text>
            </View>
          </View>
          <View style={s.half}>
            <View style={s.head}>
              <Text style={s.d1}>Deductions</Text>
              <Text style={s.d2}>Amount</Text>
            </View>
            {deductions.length === 0 ? (
              <View style={s.row}>
                <Text style={s.d1}>—</Text>
                <Text style={s.d2}>0.00</Text>
              </View>
            ) : (
              deductions.map(([k, v]) => (
                <View key={k} style={s.row}>
                  <Text style={s.d1}>{k}</Text>
                  <Text style={s.d2}>{inr(v)}</Text>
                </View>
              ))
            )}
            <View style={s.total}>
              <Text style={s.d1}>Total Deductions</Text>
              <Text style={s.d2}>{inr(a.totalDeductions)}</Text>
            </View>
          </View>
        </View>

        <View style={s.net}>
          <View style={s.netLine}>
            <Text>Net Payable</Text>
            <Text>Rs. {inr(a.net)}</Text>
          </View>
          <Text style={s.words}>{rupeesInWords(a.net)}</Text>
        </View>

        {a.pfEmployer > 0 || a.esicEmployer > 0 ? (
          <Text style={s.note}>
            Employer contribution (not deducted from salary): PF {inr(a.pfEmployer)}, ESIC {inr(a.esicEmployer)}.
          </Text>
        ) : null}
        <Text style={s.note}>This is a computer-generated payslip.</Text>
        <View style={s.signs}>
          <Text>Employee Signature</Text>
          <Text>Authorised Signatory</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderSalarySlipPdf(d: SalarySlipData): Promise<Buffer> {
  return Buffer.from(await renderToBuffer(<SlipDocument d={d} />));
}
