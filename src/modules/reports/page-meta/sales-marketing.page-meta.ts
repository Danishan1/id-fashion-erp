import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "sales-marketing";

const linkBuilders = {
  enquiry: (row: Record<string, unknown>) => (row.enquiryId ? `/sales-marketing/enquiries/${row.enquiryId}` : undefined),
  quotation: (row: Record<string, unknown>) => (row.quotationId ? `/sales-marketing/quotations/${row.quotationId}` : undefined),
  salesOrder: (row: Record<string, unknown>) => (row.salesOrderId ? `/sales-orders/${row.salesOrderId}` : undefined),
};

const customer = { key: "customerId", label: "Customer", type: "select" as const, optionsUrl: "/api/v1/customers?pageSize=200" };
const owner = { key: "ownerUserId", label: "Owner", type: "select" as const, optionsUrl: "/api/v1/sales-marketing/owners", optionsLabelKey: "fullName" };

registerReportPageMeta({
  category: CATEGORY,
  key: "enquiry-register",
  title: "Enquiry Register",
  description: "Sales enquiries you can see, by enquiry date: stage, owner, follow-up and how many quotations each has.",
  filterFields: [
    {
      key: "stage",
      label: "Stage",
      type: "select",
      options: [
        ["NEW", "New"],
        ["UNDER_REVIEW", "Under review"],
        ["QUALIFIED", "Qualified"],
        ["QUOTATION_IN_PROGRESS", "Quotation in progress"],
        ["QUOTED", "Quoted"],
        ["WON", "Won"],
        ["LOST", "Lost"],
        ["NOT_QUALIFIED", "Not qualified"],
        ["ON_HOLD", "On hold"],
      ].map(([value, label]) => ({ value, label })),
    },
    customer,
    owner,
  ],
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "quotation-register",
  title: "Quotation Register",
  description: "Quotations you can see with their current revision, by quotation date, with taxable value, GST and total.",
  filterFields: [
    {
      key: "status",
      label: "Status",
      type: "select",
      options: [
        ["DRAFT", "Draft"],
        ["PENDING_APPROVAL", "Pending approval"],
        ["APPROVED", "Approved"],
        ["ISSUED", "Issued (not expired)"],
        ["EXPIRED", "Expired"],
        ["ACCEPTED", "Accepted"],
        ["REJECTED", "Rejected"],
        ["CONVERTED", "Converted"],
        ["CANCELLED", "Cancelled"],
      ].map(([value, label]) => ({ value, label })),
    },
    customer,
    owner,
  ],
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "quotation-conversion",
  title: "Quotation → Order Conversion",
  description: "Accepted quotations (by acceptance date) and the Sales Order made from each: conversion rate, days to convert, order status and value.",
  filterFields: [
    customer,
    {
      key: "result",
      label: "Result",
      type: "select",
      options: [
        { value: "converted", label: "Converted" },
        { value: "pending", label: "Awaiting conversion" },
      ],
    },
  ],
  linkBuilders,
});
