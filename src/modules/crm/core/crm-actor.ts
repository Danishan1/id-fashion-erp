/**
 * Who is performing a CRM operation. Built once per request from the ERP
 * session (see crm-route.ts) — the CRM never has its own user model.
 * Same shape every other module's ActorContext already uses.
 */
export interface CrmActor {
  companyId: string;
  userId: string;
  branchId: string | null;
}
