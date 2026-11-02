
"use strict";

const crypto = require("node:crypto");
const express = require("express");
const REPLIES = require("./replies.json");

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

function randomReply(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "Hello! I'm Andar. How can I help you?";
  }

  return messages[Math.floor(Math.random() * messages.length)];
}

function chooseReply(message) {
  const text = message.toLowerCase().trim();

  if (/^(hi|hello|hey|hii|hiii|yo)\b/.test(text)) {
    return randomReply(REPLIES.greetings);
  }

  if (/good morning|morning/.test(text)) {
    return randomReply(REPLIES.morning);
  }

  if (/good afternoon|afternoon/.test(text)) {
    return randomReply(REPLIES.afternoon);
  }

  if (/good evening|evening/.test(text)) {
    return randomReply(REPLIES.evening);
  }

  if (/thank|thanks|thx/.test(text)) {
    return randomReply(REPLIES.thanks);
  }

  if (/bye|goodbye|see you|gtg/.test(text)) {
    return randomReply(REPLIES.goodbye);
  }

  if (text.endsWith("?")) {
    return randomReply(REPLIES.questions);
  }

  return randomReply(REPLIES.fallback);
}

app.get("/health", (_req, res) => {
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
  if (!APP_SECRET) return false;

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

  const reply = chooseReply(incoming);

  console.log("[ANDAR] Incoming:", incoming);
  console.log("[ANDAR] Reply:", reply);

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
