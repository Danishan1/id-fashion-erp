import type { TemplateEntity } from "@/modules/crm/templates/template-registry";

/** Records campaign messages can fill variables from (client-safe; used by delivery-render and the content editor). */
export const DELIVERY_TEMPLATE_ENTITIES: ReadonlySet<TemplateEntity> = new Set<TemplateEntity>(["contact", "company", "user"]);
