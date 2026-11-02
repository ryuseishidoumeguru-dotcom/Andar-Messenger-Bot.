
"use strict";

const crypto = require("node:crypto");
const express = require("express");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "";
const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || "";
const APP_SECRET = process.env.META_APP_SECRET || "";
const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || "";

app.use(express.json({
  verify(req, res, buffer) {
    req.rawBody = Buffer.from(buffer);
  }
}));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "Andar",
    messengerConfigured: Boolean(
      VERIFY_TOKEN && PAGE_ACCESS_TOKEN && GRAPH_VERSION
    )
  });
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN && VERIFY_TOKEN) {
    return res.status(200).send(String(challenge || ""));
  }

  return res.sendStatus(403);
});

function validSignature(req) {
  if (!APP_SECRET) return true;

  const header = req.get("x-hub-signature-256") || "";
  const signature = header.startsWith("sha256=")
    ? header.slice(7)
    : "";

  if (!signature || !req.rawBody) return false;

  const expected = crypto
    .createHmac("sha256", APP_SECRET)
    .update(req.rawBody)
    .digest("hex");

  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

async function sendText(recipientId, message) {
  if (!PAGE_ACCESS_TOKEN || !GRAPH_VERSION) {
    console.error("[ANDAR] Messenger configuration is missing.");
    return;
  }

  const url =
    \`https://graph.facebook.com/\${GRAPH_VERSION}/me/messages\`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: \`Bearer \${PAGE_ACCESS_TOKEN}\`
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text: message }
    })
  });

  if (!response.ok) {
    console.error(
      "[ANDAR] Messenger API error:",
      response.status,
      await response.text()
    );
  }
}

async function handleEvent(event) {
  if (!event.sender?.id || !event.message) return;
  if (event.message.is_echo) return;

  const incoming = event.message.text?.trim();
  if (!incoming) return;

  if (process.env.AUTO_REPLY_ENABLED !== "true") return;

  const reply =
    process.env.AUTO_REPLY_MESSAGE ||
    "Hello! I'm Andar. How can I help you?";

  await sendText(event.sender.id, reply);
}

app.post("/webhook", (req, res) => {
  if (!validSignature(req)) {
    return res.sendStatus(401);
  }

  if (req.body?.object !== "page") {
    return res.sendStatus(404);
  }

  res.sendStatus(200);

  for (const entry of req.body.entry || []) {
    for (const event of entry.messaging || []) {
      handleEvent(event).catch(error => {
        console.error("[ANDAR] Error:", error.message);
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(\`[ANDAR] Running on port \${PORT}\`);
});
