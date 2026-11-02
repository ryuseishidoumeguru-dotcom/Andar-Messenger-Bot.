
"use strict";

const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "50kb" }));

const PORT = process.env.PORT || 3000;
const API_KEY = String(
  process.env.ECLIPSE_DASHBOARD_API_KEY || ""
).trim();

const defaultReplies = [
  "Hello!",
  "Really?",
  "Okay!",
  "HAHA!",
  "I see.",
  "Nice!",
  "Ohh!",
  "Sure!",
  "Interesting!",
  "Alright!"
];

const settings = {
  enabled: false,
  cooldown: 10,
  startTime: "08:00",
  endTime: "22:00",
  replies: [...defaultReplies]
};

function isConfigured(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function authenticate(req, res, next) {
  if (!API_KEY) {
    return res.status(503).json({
      error: "ECLIPSE_DASHBOARD_API_KEY is not configured."
    });
  }

  const supplied = String(
    req.headers.authorization || ""
  ).replace(/^Bearer\s+/i, "");

  const a = Buffer.from(supplied);
  const b = Buffer.from(API_KEY);

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    return res.status(401).json({
      error: "Invalid dashboard API key."
    });
  }

  next();
}

function isWithinSchedule() {
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();

  const [sh, sm] = settings.startTime.split(":").map(Number);
  const [eh, em] = settings.endTime.split(":").map(Number);

  const start = sh * 60 + sm;
  const end = eh * 60 + em;

  if (start === end) return true;

  if (start < end) {
    return current >= start && current < end;
  }

  return current >= start || current < end;
}

function getStatus() {
  return {
    dashboard: "online",
    autoResponse: settings.enabled,
    scheduleActive: isWithinSchedule(),
    cooldown: settings.cooldown,
    startTime: settings.startTime,
    endTime: settings.endTime,
    replies: settings.replies,
    facebookConfiguration: {
      appstateConfigured: isConfigured("FB_APPSTATE"),
      cookiesConfigured: isConfigured("FB_COOKIES")
    },
    encryptionKeyConfigured:
      isConfigured("ECLIPSE_SESSION_ENCRYPTION_KEY") &&
      Buffer.byteLength(
        process.env.ECLIPSE_SESSION_ENCRYPTION_KEY,
        "utf8"
      ) >= 32
  };
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (req, res) => {
  res.redirect("/dashboard");
});

app.get("/dashboard", (req, res) => {
  res.type("html").send(`
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Andar Dashboard</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #10121a;
      color: white;
      font-family: Arial, sans-serif;
    }
    .card {
      background: #1c2030;
      padding: 18px;
      border-radius: 12px;
      margin-bottom: 15px;
    }
    input, textarea, button {
      box-sizing: border-box;
      width: 100%;
      padding: 12px;
      margin: 7px 0;
      border-radius: 7px;
      border: 0;
    }
    button {
      background: #5865f2;
      color: white;
      font-weight: bold;
      cursor: pointer;
    }
    .status { color: #9ee6a4; }
    .warning { color: #ffd166; }
  </style>
</head>
<body>
  <h2>ANDAR Messenger Dashboard</h2>

  <div class="card">
    <h3>Dashboard connection</h3>
    <input id="key" type="password" placeholder="Dashboard API key">
    <button onclick="connect()">Connect</button>
    <p id="connection">Not connected</p>
  </div>

  <div id="panel" style="display:none">
    <div class="card">
      <h3>Bot status</h3>
      <p id="status"></p>
      <p id="facebook"></p>
      <p id="encryption"></p>
    </div>

    <div class="card">
      <h3>Auto-response setting</h3>
      <button onclick="toggleBot()">Toggle ON / OFF</button>
      <p id="enabled"></p>
    </div>

    <div class="card">
      <h3>Cooldown</h3>
      <input id="cooldown" type="number" min="1" max="3600">
      <button onclick="saveCooldown()">Save cooldown</button>
    </div>

    <div class="card">
      <h3>Schedule</h3>
      <label>Start time</label>
      <input id="start" type="time">
      <label>End time</label>
      <input id="end" type="time">
      <button onclick="saveSchedule()">Save schedule</button>
      <p>Overnight schedules are supported.</p>
    </div>

    <div class="card">
      <h3>Random replies</h3>
      <textarea id="replies" rows="10"></textarea>
      <button onclick="saveReplies()">Save replies</button>
      <button onclick="preview()">Preview random reply</button>
      <p id="preview"></p>
    </div>
  </div>

<script>
let apiKey = "";

async function api(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

async function connect() {
  apiKey = document.getElementById("key").value.trim();

  try {
    await refresh();
    document.getElementById("panel").style.display = "block";
    document.getElementById("connection").textContent =
      "Connected successfully";
  } catch (error) {
    document.getElementById("connection").textContent =
      error.message;
  }
}

async function refresh() {
  const data = await api("/api/status");

  document.getElementById("status").textContent =
    "Dashboard: " + data.dashboard +
    " | Schedule active: " + data.scheduleActive;

  document.getElementById("enabled").textContent =
    "Auto-response: " +
    (data.autoResponse ? "ON" : "OFF");

  document.getElementById("facebook").textContent =
    "FB_APPSTATE: " +
    (data.facebookConfiguration.appstateConfigured
      ? "Configured" : "Missing") +
    " | FB_COOKIES: " +
    (data.facebookConfiguration.cookiesConfigured
      ? "Configured" : "Missing");

  document.getElementById("encryption").textContent =
    "Encryption key length check: " +
    (data.encryptionKeyConfigured ? "Passed" : "Missing or too short");

  document.getElementById("cooldown").value = data.cooldown;
  document.getElementById("start").value = data.startTime;
  document.getElementById("end").value = data.endTime;
  document.getElementById("replies").value =
    data.replies.join("\\n");
}

async function toggleBot() {
  try {
    const data = await api("/api/toggle", "POST");
    document.getElementById("enabled").textContent =
      "Auto-response: " + (data.enabled ? "ON" : "OFF");
  } catch (error) {
    alert(error.message);
  }
}

async function saveCooldown() {
  try {
    await api("/api/settings", "POST", {
      cooldown: Number(document.getElementById("cooldown").value)
    });
    alert("Cooldown saved");
  } catch (error) {
    alert(error.message);
  }
}

async function saveSchedule() {
  try {
    await api("/api/settings", "POST", {
      startTime: document.getElementById("start").value,
      endTime: document.getElementById("end").value
    });
    alert("Schedule saved");
  } catch (error) {
    alert(error.message);
  }
}

async function saveReplies() {
  try {
    await api("/api/settings", "POST", {
      replies: document.getElementById("replies").value
        .split("\\n")
        .map(x => x.trim())
        .filter(Boolean)
    });
    alert("Replies saved");
  } catch (error) {
    alert(error.message);
  }
}

async function preview() {
  try {
    const data = await api("/api/preview");
    document.getElementById("preview").textContent =
      "Random reply: " + data.reply;
  } catch (error) {
    alert(error.message);
  }
}
</script>
</body>
</html>
  `);
});

app.use("/api", authenticate);

app.get("/api/status", (req, res) => {
  res.json(getStatus());
});

app.post("/api/toggle", (req, res) => {
  settings.enabled = !settings.enabled;
  res.json({ enabled: settings.enabled });
});

app.post("/api/settings", (req, res) => {
  const body = req.body || {};

  if (body.cooldown !== undefined) {
    const value = Number(body.cooldown);

    if (!Number.isInteger(value) || value < 1 || value > 3600) {
      return res.status(400).json({
        error: "Cooldown must be between 1 and 3600 seconds."
      });
    }

    settings.cooldown = value;
  }

  if (body.startTime !== undefined) {
    if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(body.startTime)) {
      return res.status(400).json({ error: "Invalid start time." });
    }
    settings.startTime = body.startTime;
  }

  if (body.endTime !== undefined) {
    if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(body.endTime)) {
      return res.status(400).json({ error: "Invalid end time." });
    }
    settings.endTime = body.endTime;
  }

  if (body.replies !== undefined) {
    if (
      !Array.isArray(body.replies) ||
      body.replies.length < 1 ||
      body.replies.length > 100
    ) {
      return res.status(400).json({
        error: "Provide between 1 and 100 replies."
      });
    }

    settings.replies = body.replies
      .map(x => String(x).trim().slice(0, 200))
      .filter(Boolean);

    if (!settings.replies.length) {
      return res.status(400).json({
        error: "At least one reply is required."
      });
    }
  }

  res.json({ success: true, settings });
});

app.get("/api/preview", (req, res) => {
  const replies = settings.replies;
  const reply = replies[
    crypto.randomInt(0, replies.length)
  ];

  res.json({ reply });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Andar dashboard running on port " + PORT);
});
