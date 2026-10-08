import crypto from "node:crypto";

const WEBHOOK_URL =
  "http://localhost:3001/api/v1/crm/webhooks/conversations/generic/b6602588-e127-4ee7-a44b-ae528e9b2614";

const SECRET = "whsec_2xvnK6PdJfz2XzS3vNkYbmXJo92QIVoO";

async function main() {
  // Change this ID for each NEW message.
  // Sending the same ID again tests duplicate handling.
  const MESSAGE_ID = "msg-1001";

  const body = {
    type: "message",
    id: MESSAGE_ID,
    from: {
      phone: "+91 98765 43210",
      name: "Asha Rao",
      email: "asha@example.com",
    },
    text: "Hi, can you share the catalogue?",
  };

  // Unix timestamp in seconds
  const timestamp = Math.floor(Date.now() / 1000);

  // IMPORTANT:
  // The signature must use the EXACT raw body that is sent.
  const rawBody = JSON.stringify(body);

  // HMAC-SHA256(secret, "<timestamp>.<raw body>")
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  console.log("========================================");
  console.log("CRM Webhook Test");
  console.log("========================================");
  console.log("URL:", WEBHOOK_URL);
  console.log("Timestamp:", timestamp);
  console.log("Message ID:", MESSAGE_ID);
  console.log("Signature:", `sha256=${signature}`);
  console.log("Body:", rawBody);
  console.log("----------------------------------------");
  console.log("Sending request...\n");

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CRM-Timestamp": timestamp.toString(),
        "X-CRM-Signature": `sha256=${signature}`,
      },
      body: rawBody,
    });

    const responseText = await response.text();

    console.log("========================================");
    console.log("Response");
    console.log("========================================");
    console.log("HTTP Status:", response.status);
    console.log("Status Text:", response.statusText);
    console.log("Response Body:", responseText);
    console.log("----------------------------------------");

    if (response.ok) {
      console.log("✅ Webhook request succeeded");
    } else {
      console.log("❌ Webhook request failed");
    }
  } catch (error) {
    console.error("========================================");
    console.error("Connection Error");
    console.error("========================================");
    console.error("❌ Could not connect to webhook.");
    console.error(error);
  }
}

main().catch((error) => {
  console.error("❌ Unexpected error:");
  console.error(error);
  process.exit(1);
});
