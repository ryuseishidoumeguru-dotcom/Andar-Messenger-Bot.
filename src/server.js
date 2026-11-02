
"use strict";

const express = require("express");
const crypto = require("crypto");

const app = express();

// ==============================
// CONFIGURATION
// ==============================

const PORT = process.env.PORT || 3000;

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "";
const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || "";
const APP_SECRET = process.env.META_APP_SECRET || "";

const GRAPH_VERSION =
  process.env.META_GRAPH_API_VERSION || "v23.0";

const AUTO_REPLY_ENABLED =
  String(process.env.AUTO_REPLY_ENABLED || "false").toLowerCase() === "true";

// ==============================
// RANDOM REPLIES
// ==============================

const RANDOM_REPLIES = [
  "Hello!",
  "Hi!",
  "Hey!",
  "Okay!",
  "Really?",
  "Nice!",
  "Cool!",
  "Interesting!",
  "Haha!",
  "LOL!",
  "Wow!",
  "Amazing!",
  "Sure!",
  "Alright!",
  "Maybe!",
  "Of course!",
  "I see!",
  "What's up?",
  "How are you?",
  "Good!",
  "Great!",
  "Not bad!",
  "Thanks!",
  "You're welcome!",
  "Hmm...",
  "Oh!",
  "Yeah!",
  "No way!",
  "Let's go!",
  "Wonderful!",
  "Indeed!",
  "Got it!",
  "Take care!",
  "See you!",
  "Perfect!",
  "Awesome!",
  "Random!",
  "Let's see!",
  "Why not?",
  "Okay then!"
];

function randomReply() {
  const index = Math.floor(Math.random() * RANDOM_REPLIES.length);
  return RANDOM_REPLIES[index];
}

// ==============================
// RAW BODY FOR SIGNATURE CHECK
// ==============================

app.use(
  express.json({
    verify: (req, res, buffer) => {
      req.rawBody = buffer;
    }
  })
);

// ==============================
// META SIGNATURE VALIDATION
// ==============================

function validSignature(req) {
  if (!APP_SECRET || !req.rawBody) {
    return false;
  }

  const signature = req.get("x-hub-signature-256");

  if (!signature || !signature.startsWith("sha256=")) {
    return false;
  }

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", APP_SECRET)
      .update(req.rawBody)
      .digest("hex");

  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

// ==============================
// SEND MESSENGER MESSAGE
// ==============================

async function sendText(recipientId, messageText) {
  if (!PAGE_ACCESS_TOKEN) {
    throw new Error("META_PAGE_ACCESS_TOKEN is missing.");
  }

  const url =
    "https://graph.facebook.com/" +
    GRAPH_VERSION +
    "/me/messages";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + PAGE_ACCESS_TOKEN
    },
    body: JSON.stringify({
      recipient: {
        id: recipientId
      },
      messaging_type: "RESPONSE",
      message: {
        text: messageText
      }
    })
  });

  const result = await response.json();

  if (!response.ok) {
    console.error("[MESSENGER ERROR]", result);
    throw new Error("Messenger API request failed.");
  }

  console.log("[MESSAGE SENT]", recipientId);
}

// ==============================
// DUPLICATE MESSAGE PROTECTION
// ==============================

const processedMessages = new Set();

function alreadyProcessed(messageId) {
  if (!messageId) return false;

  if (processedMessages.has(messageId)) {
    return true;
  }

  processedMessages.add(messageId);

  if (processedMessages.size > 5000) {
    const oldest = processedMessages.values().next().value;
    processedMessages.delete(oldest);
  }

  return false;
}

// ==============================
// PROCESS INCOMING MESSAGE
// ==============================

async function processMessage(event) {
  try {
    if (!AUTO_REPLY_ENABLED) return;

    if (!event.sender || !event.sender.id) return;
    if (!event.message) return;
    if (event.message.is_echo) return;
    if (!event.message.text) return;

    if (alreadyProcessed(event.message.mid)) return;

    const incomingText = event.message.text.trim();

    if (!incomingText) return;

    const reply = randomReply();

    console.log("[ANDAR] Incoming:", incomingText);
    console.log("[ANDAR] Reply:", reply);

    await sendText(event.sender.id, reply);

  } catch (error) {
    console.error("[MESSAGE PROCESSING ERROR]", error.message);
  }
}

// ==============================
// HEALTH CHECK
// ==============================

app.get("/", (req, res) => {
  res.status(200).send("Andar Messenger Bot is running.");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "online",
    bot: "Andar",
    autoReply: AUTO_REPLY_ENABLED
  });
});

// ==============================
// META WEBHOOK VERIFICATION
// ==============================

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("[WEBHOOK] Verified");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// ==============================
// RECEIVE MESSENGER EVENTS
// ==============================

app.post("/webhook", (req, res) => {
  if (!validSignature(req)) {
    console.error("[WEBHOOK] Invalid signature or missing app secret.");
    return res.sendStatus(403);
  }

  if (req.body.object !== "page") {
    return res.sendStatus(404);
  }

  // Acknowledge Meta immediately.
  res.sendStatus(200);

  const entries = req.body.entry || [];

  for (const entry of entries) {
    const events = entry.messaging || [];

    for (const event of events) {
      processMessage(event);
    }
  }
});

// ==============================
// START SERVER
// ==============================

app.listen(PORT, () => {
  console.log("--------------------------------");
  console.log("ANDAR MESSENGER BOT");
  console.log("--------------------------------");
  console.log("Port:", PORT);
  console.log("Auto reply:", AUTO_REPLY_ENABLED ? "ON" : "OFF");
  console.log("Graph API:", GRAPH_VERSION);
  console.log("Webhook: /webhook");
  console.log("--------------------------------");

  if (!APP_SECRET) {
    console.error("[CONFIG WARNING] META_APP_SECRET is missing.");
  }

  if (!PAGE_ACCESS_TOKEN) {
    console.error("[CONFIG WARNING] META_PAGE_ACCESS_TOKEN is missing.");
  }
});
