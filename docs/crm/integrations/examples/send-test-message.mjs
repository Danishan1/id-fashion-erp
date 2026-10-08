// Sends one signed test message (or delivery receipt) to a CRM channel — no provider needed.
//
//   CRM_WEBHOOK_URL=… CRM_SIGNING_SECRET=… node send-test-message.mjs --phone "+91 98100 12345" --name "Asha Rao" --text "Hi, do you have polo shirts?"
//   … --email asha@example.com --subject "Quotation" --text "Please send prices"      (email channels)
//   … --id psid-123 --text "Hello from Messenger"                                      (Messenger / Instagram)
//   … --session visitor-session-0001 --text "Hello from the website"                  (website chat)
//   … --status delivered --message-id <provider message id>                            (delivery receipt)
//
// Prints the CRM's answer: outcome "created" (new message), "duplicate" (same id sent before),
// or "applied" / "ignored" / "unknown_message" for receipts.

import { randomUUID } from "node:crypto";
import { sendToCrm } from "./crm-bridge-kit.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1]]] : acc), [])
);

const event = args.status
  ? { type: "status", messageId: args["message-id"], status: args.status }
  : {
      type: "message",
      id: args["message-id"] ?? `test-${randomUUID()}`,
      from: { ...(args.phone && { phone: args.phone }), ...(args.email && { email: args.email }), ...(args.id && { id: args.id }), ...(args.session && { sessionId: args.session }), ...(args.name && { name: args.name }) },
      text: args.text ?? "Test message",
      ...(args.subject && { subject: args.subject }),
      ...(args.thread && { threadId: args.thread }),
    };

const data = await sendToCrm([event]);
console.log(JSON.stringify(data, null, 2));
