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
  category: "attendance",
  key: "daily-attendance",
  title: "Daily Attendance",
  description: "Attendance records for one specific date.",
  includeDateRange: false,
  filterFields: [{ key: "date", label: "Date", type: "date" }],
});

registerReportPageMeta({
  category: "attendance",
  key: "monthly-attendance-summary",
  title: "Monthly Attendance Summary",
  description: "Present/Late day counts per employee for one calendar month.",
  filterFields: [{ key: "dateFrom", label: "Any Date in Month", type: "date" }],
});
