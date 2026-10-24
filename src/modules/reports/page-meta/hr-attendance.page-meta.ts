import { registerReportPageMeta } from "../report-page-meta";

const statusOptions = [
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
];

registerReportPageMeta({
  category: "hr",
  key: "employee-register",
  title: "Employee Register",
  description: "All employees matching the selected filters.",
  includeDateRange: false,
  filterFields: [
    { key: "departmentId", label: "Department", type: "select", optionsUrl: "/api/v1/departments?pageSize=200" },
    { key: "status", label: "Status", type: "select", options: statusOptions },
  ],
  linkBuilders: { employee: (row) => (row.employeeId ? `/masters/employees/${row.employeeId}` : undefined) },
});

registerReportPageMeta({
  category: "hr",
  key: "department-wise-employees",
  title: "Department-wise Employees",
  description: "Active employees grouped by department.",
  includeDateRange: false,
});

registerReportPageMeta({
  category: "hr",
  key: "leave-register",
  title: "Leave Register",
  description: "Every leave request matching the selected filters.",
  filterFields: [
    { key: "employeeId", label: "Employee", type: "select", optionsUrl: "/api/v1/employees?pageSize=200", optionsLabelKey: "fullName" },
    { key: "status", label: "Status", type: "select", options: ["PENDING", "APPROVED", "REJECTED"].map((s) => ({ value: s, label: s })) },
  ],
});

registerReportPageMeta({
  category: "attendance",
  key: "daily-attendance",
  title: "Daily Attendance",
  description: "Every employee on one date: first in, last out, hours, status, late and outside punches.",
  includeDateRange: false,
  filterFields: [{ key: "date", label: "Date", type: "date" }],
});

registerReportPageMeta({
  category: "attendance",
  key: "monthly-attendance-summary",
  title: "Monthly Attendance Summary",
  description: "Present, paid/unpaid leave, absent, sandwich, late, hours and overtime per employee for one month.",
  filterFields: [{ key: "dateFrom", label: "Any Date in Month", type: "date" }],
});

registerReportPageMeta({
  category: "attendance",
  key: "overtime-register",
  title: "Overtime Register",
  description: "Auto-calculated overtime per employee-day with approval status and amount.",
  filterFields: [
    { key: "employeeId", label: "Employee", type: "select", optionsUrl: "/api/v1/employees?pageSize=200", optionsLabelKey: "fullName" },
    { key: "status", label: "Status", type: "select", options: ["PENDING", "APPROVED", "REJECTED"].map((s) => ({ value: s, label: s })) },
  ],
});

registerReportPageMeta({
  category: "attendance",
  key: "outdoor-punch-register",
  title: "Outdoor Punch Register",
  description: "Punches made outside the office geofence and the decision taken on each.",
  filterFields: [{ key: "employeeId", label: "Employee", type: "select", optionsUrl: "/api/v1/employees?pageSize=200", optionsLabelKey: "fullName" }],
});
