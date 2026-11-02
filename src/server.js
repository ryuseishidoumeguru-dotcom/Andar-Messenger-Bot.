
"use strict";

const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "50kb" }));

const PORT = process.env.PORT || 3000;
const API_KEY = String(
  process.env.ECLIPSE_DASHBOARD_API_KEY || ""
).trim();

const TIME_ZONE = "Asia/Manila";

const settings = {
  enabled: false,
  cooldown: 10,
  startTime: "08:00",
  endTime: "22:00",
  replies: [
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
  ],
  groups: [],
  selfReact: false
};

function configured(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function authenticate(req, res, next) {
  if (!API_KEY) {
    return res.status(503).json({
      error: "Dashboard API key is missing."
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

function getManilaMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const hour = Number(
    parts.find(p => p.type === "hour").value
  );

  const minute = Number(
    parts.find(p => p.type === "minute").value
  );

  return hour * 60 + minute;
}

function isWithinSchedule() {
  const current = getManilaMinutes();

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
    timeZone: TIME_ZONE,
    cooldown: settings.cooldown,
    startTime: settings.startTime,
    endTime: settings.endTime,
    replies: settings.replies,
    groups: settings.groups,
    selfReact: settings.selfReact,
    facebookConfiguration: {
      appstateConfigured: configured("FB_APPSTATE"),
      cookiesConfigured: configured("FB_COOKIES")
    },
    encryptionKeyConfigured:
      configured("ECLIPSE_SESSION_ENCRYPTION_KEY") &&
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
  res.type("html").send(`<!DOCTYPE html>
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
}
.group {
  display: flex;
  align-items: center;
  gap: 10px;
}
.group input {
  width: auto;
}
.small {
  color: #b8bfd2;
  font-size: 13px;
}
</style>
</head>
<body>

<h2>ANDAR Dashboard</h2>

<div class="card">
<h3>Dashboard login</h3>
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
<p class="small">Facebook session variables are only checked for presence.</p>
</div>

<div class="card">
<h3>Auto-response</h3>
<button onclick="toggleBot()">Toggle ON / OFF</button>
<p id="enabled"></p>
</div>

<div class="card">
<h3>Schedule (Philippine time)</h3>
<label>Start time</label>
<input id="start" type="time">
<label>End time</label>
<input id="end" type="time">
<button onclick="saveSchedule()">Save schedule</button>
<p id="scheduleResult"></p>
</div>

<div class="card">
<h3>Cooldown</h3>
<input id="cooldown" type="number" min="1" max="3600">
<button onclick="saveCooldown()">Save cooldown</button>
</div>

<div class="card">
<h3>Random replies</h3>
<textarea id="replies" rows="10"></textarea>
<button onclick="saveReplies()">Save replies</button>
<button onclick="preview()">Preview random reply</button>
<p id="previewResult"></p>
</div>

<div class="card">
<h3>Group selection</h3>
<p class="small">
Add group names manually. These are saved as dashboard settings
and are not connected to Messenger.
</p>
<input id="groupName" placeholder="Enter group name">
<button onclick="addGroup()">Add group</button>
<div id="groups"></div>
</div>

<div class="card">
<h3>Self-reaction setting</h3>
<button onclick="toggleReact()">Toggle self-reaction setting</button>
<p id="reactStatus"></p>
<p class="small">
This is a saved preference only. No reactions are sent.
</p>
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
    " | Schedule active: " + data.scheduleActive +
    " | Timezone: " + data.timeZone;

  document.getElementById("enabled").textContent =
    "Auto-response: " + (data.autoResponse ? "ON" : "OFF");

  document.getElementById("facebook").textContent =
    "FB_APPSTATE: " +
    (data.facebookConfiguration.appstateConfigured
      ? "Configured" : "Missing") +
    " | FB_COOKIES: " +
    (data.facebookConfiguration.cookiesConfigured
      ? "Configured" : "Missing");

  document.getElementById("encryption").textContent =
    "Encryption key check: " +
    (data.encryptionKeyConfigured ? "Passed" : "Missing or too short");

  document.getElementById("cooldown").value = data.cooldown;
  document.getElementById("start").value = data.startTime;
  document.getElementById("end").value = data.endTime;
  document.getElementById("replies").value =
    data.replies.join("\\n");

  document.getElementById("reactStatus").textContent =
    "Self-reaction setting: " +
    (data.selfReact ? "ON" : "OFF");

  renderGroups(data.groups);
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

async function saveSchedule() {
  try {
    await api("/api/settings", "POST", {
      startTime: document.getElementById("start").value,
      endTime: document.getElementById("end").value
    });
    await refresh();
    document.getElementById("scheduleResult").textContent =
      "Schedule saved using Philippine time.";
  } catch (error) {
    alert(error.message);
  }
}

async function saveCooldown() {
  try {
    await api("/api/settings", "POST", {
      cooldown: Number(document.getElementById("cooldown").value)
    });
    alert("Cooldown saved.");
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
    alert("Replies saved.");
  } catch (error) {
    alert(error.message);
  }
}

async function preview() {
  try {
    const data = await api("/api/preview");
    document.getElementById("previewResult").textContent =
      "Random reply: " + data.reply;
  } catch (error) {
    alert(error.message);
  }
}

async function addGroup() {
  const name = document.getElementById("groupName").value.trim();
  if (!name) return;

  try {
    const data = await api("/api/groups", "POST", { name });
    renderGroups(data.groups);
    document.getElementById("groupName").value = "";
  } catch (error) {
    alert(error.message);
  }
}

async function removeGroup(name) {
  try {
    const data = await api("/api/groups/remove", "POST", { name });
    renderGroups(data.groups);
  } catch (error) {
    alert(error.message);
  }
}

function renderGroups(groups) {
  const container = document.getElementById("groups");
  container.innerHTML = "";

  groups.forEach(name => {
    const item = document.createElement("div");
    item.className = "group";

    const label = document.createElement("span");
    label.textContent = name;

    const button = document.createElement("button");
    button.textContent = "Remove";
    button.onclick = () => removeGroup(name);

    item.append(label, button);
    container.appendChild(item);
  });
}

async function toggleReact() {
  try {
    const data = await api("/api/react-toggle", "POST");
    document.getElementById("reactStatus").textContent =
      "Self-reaction setting: " + (data.enabled ? "ON" : "OFF");
  } catch (error) {
    alert(error.message);
  }
}
</script>
</body>
</html>`);
});

app.use("/api", authenticate);

app.get("/api/status", (req, res) => {
  res.json(getStatus());
});

app.post("/api/toggle", (req, res) => {
  settings.enabled = !settings.enabled;
  res.json({ enabled: settings.enabled });
});

app.post("/api/react-toggle", (req, res) => {
  settings.selfReact = !settings.selfReact;
  res.json({ enabled: settings.selfReact });
});

app.post("/api/groups", (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 100);

  if (!name) {
    return res.status(400).json({ error: "Enter a group name." });
  }

  if (!settings.groups.includes(name)) {
    settings.groups.push(name);
  }

  res.json({ groups: settings.groups });
});

app.post("/api/groups/remove", (req, res) => {
  const name = String(req.body?.name || "");
  settings.groups = settings.groups.filter(x => x !== name);
  res.json({ groups: settings.groups });
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

  for (const field of ["startTime", "endTime"]) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "string" ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(body[field])) {
        return res.status(400).json({
          error: "Invalid " + field + ". Use HH:MM."
        });
      }

      settings[field] = body[field];
    }
  }

  if (body.replies !== undefined) {
    if (!Array.isArray(body.replies) ||
        body.replies.length < 1 ||
        body.replies.length > 100) {
      return res.status(400).json({
        error: "Provide between 1 and 100 replies."
      });
    }

    const replies = body.replies
      .map(x => String(x).trim().slice(0, 200))
      .filter(Boolean);

    if (!replies.length) {
      return res.status(400).json({
        error: "At least one reply is required."
      });
    }

    settings.replies = replies;
  }

  res.json({ success: true });
});

app.get("/api/preview", (req, res) => {
  const replies = settings.replies;
  res.json({
    reply: replies[crypto.randomInt(0, replies.length)]
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Andar dashboard running on port " + PORT);
});
