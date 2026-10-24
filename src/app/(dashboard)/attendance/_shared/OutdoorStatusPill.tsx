"use client";

import { Pill } from "./attendance-ui";

export function OutdoorStatusPill({ status, revoked }: { status: string; revoked?: boolean }) {
  if (revoked) return <Pill tone="blue">Cancelled — times restored</Pill>;
  switch (status) {
    case "PENDING":
      return <Pill tone="amber">Waiting for employee</Pill>;
    case "IN_PROCESS":
      return <Pill tone="purple">Clarification sent</Pill>;
    case "APPROVED":
      return <Pill tone="green">Closed</Pill>;
    case "REJECTED":
      return <Pill tone="red">Clarification rejected</Pill>;
    default:
      return <Pill>{status}</Pill>;
  }
}
