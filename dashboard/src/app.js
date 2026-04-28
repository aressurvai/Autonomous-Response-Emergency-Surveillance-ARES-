// ============================================
//   A.R.E.S — Main Application Logic
// ============================================

const API_BASE = "http://localhost:8085";
let isApiOnline = false;
let allAlerts = [];
let accuracyChart = null;
let lossChart = null;
let reputationChart = null;
let clientFootagePaths = {};

const DUMMY_ALERTS = [
  {
    id: 1,
    timestamp: "2024-03-01T10:23:15",
    client_id: "client1",
    event_type: "Theft",
    confidence: 0.91,
    time_in_video: "0:23",
    video: "footage1.mp4",
  },
  {
    id: 2,
    timestamp: "2024-03-01T10:45:02",
    client_id: "client2",
    event_type: "Fighting",
    confidence: 0.87,
    time_in_video: "0:45",
    video: "footage2.mp4",
  },
  {
    id: 3,
    timestamp: "2024-03-01T11:02:44",
    client_id: "client1",
    event_type: "Vandalism",
    confidence: 0.76,
    time_in_video: "1:02",
    video: "footage1.mp4",
  },
  {
    id: 4,
    timestamp: "2024-03-01T11:30:11",
    client_id: "client3",
    event_type: "Arrest",
    confidence: 0.93,
    time_in_video: "0:15",
    video: "footage3.mp4",
  },
  {
    id: 5,
    timestamp: "2024-03-01T12:05:33",
    client_id: "client2",
    event_type: "Shooting",
    confidence: 0.82,
    time_in_video: "2:05",
    video: "footage2.mp4",
  },
  {
    id: 6,
    timestamp: "2024-03-01T12:30:22",
    client_id: "client1",
    event_type: "Theft",
    confidence: 0.78,
    time_in_video: "1:30",
    video: "footage1.mp4",
  },
];

const DUMMY_HISTORY = [
  { round: 1, accuracy: 73.8, loss: 1.0 },
  { round: 2, accuracy: 76.9, loss: 0.7225 },
  { round: 3, accuracy: 79.6, loss: 0.6141 },
  { round: 4, accuracy: 79.6, loss: 0.6141 },
  { round: 5, accuracy: 83.9, loss: 0.4437 },
];

const DUMMY_REPUTATION = [
  { client_id: "client_0", reputation: 1.0, rounds_participated: 5 },
  { client_id: "client_1", reputation: 0.4, rounds_participated: 3 },
  { client_id: "client_2", reputation: 0.5, rounds_participated: 4 },
];

// ── ELECTRON IPC ──
let ipcRenderer = null;
try {
  const { ipcRenderer: ipc } = require("electron");
  ipcRenderer = ipc;

  ipcRenderer.on("server-log", (_, msg) => addTerminalLine(msg));
  ipcRenderer.on("server-stopped", () => {
    setServerStatus(false);
    addTerminalLine("FL Server stopped", "error");
  });
  ipcRenderer.on("client-log", (_, { clientId, msg }) =>
    addTerminalLine(`[Client ${clientId}] ${msg}`),
  );
  ipcRenderer.on("client-stopped", (_, clientId) => {
    setClientStatus(clientId, false);
  });

  // QR CODE — auto show when ready
  ipcRenderer.on("qr-ready", (_, { qrDataUrl, url }) => {
    showQRModal(qrDataUrl, url);
    const img = document.getElementById("sidebar-qr-image");
    const placeholder = document.getElementById("sidebar-qr-placeholder");
    const urlLabel = document.getElementById("sidebar-qr-url");
    if (img) {
      img.src = qrDataUrl;
      img.style.display = "block";
      if (placeholder) placeholder.style.display = "none";
    }
    if (urlLabel) urlLabel.textContent = url;
  });

  // ── STREAM READY — show MJPEG feed in camera card ──
  ipcRenderer.on("stream-ready", (_, { clientId, url }) => {
    const feedDiv = document.querySelector(`#cam-${clientId} .cam-feed`);
    const placeholder = document.querySelector(
      `#cam-${clientId} .cam-placeholder`,
    );
    const camCard = document.getElementById(`cam-${clientId}`);

    if (!feedDiv) return;

    // Remove any previous live feed img
    feedDiv.querySelector("img.live-feed")?.remove();

    const img = document.createElement("img");
    img.className = "live-feed";
    img.src = url;
    img.style.cssText =
      "width:100%;height:100%;object-fit:cover;display:block;";

    // Stream may take a second to start — retry on error
    img.onerror = () => {
      setTimeout(() => {
        img.src = url + "?t=" + Date.now();
      }, 1000);
    };

    if (placeholder) placeholder.style.display = "none";
    feedDiv.appendChild(img);
    if (camCard) camCard.style.borderColor = "var(--accent)";
    document.getElementById(`cam-${clientId}-detections`).textContent =
      "📡 Live";
  });
} catch (e) {
  console.log("Running in browser mode (no Electron)");
}

// ── QR CODE FUNCTIONS ──
function showQRModal(qrDataUrl, url) {
  if (document.getElementById("login-screen").classList.contains("active"))
    return;

  const existing = document.getElementById("qr-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "qr-modal";
  modal.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 9999;
    background: #0a1520; border: 1px solid #00ff9d;
    border-radius: 4px; padding: 16px; text-align: center;
    box-shadow: 0 0 30px rgba(0,255,157,0.2);
  `;
  modal.innerHTML = `
    <div style="font-family:'Share Tech Mono',monospace; font-size:10px;
                color:#5a8aaa; letter-spacing:2px; margin-bottom:10px;">
      SCAN TO CONNECT MOBILE
    </div>
    <img src="${qrDataUrl}" style="width:160px;height:160px;display:block;margin:0 auto;" />
    <div style="font-family:'Share Tech Mono',monospace; font-size:9px;
                color:#00ff9d; margin-top:8px;">${url}</div>
    <button onclick="document.getElementById('qr-modal').remove()"
      style="margin-top:10px; background:transparent; border:1px solid #0f2a3f;
             color:#5a8aaa; padding:4px 12px; cursor:pointer;
             font-family:'Share Tech Mono',monospace; font-size:10px; border-radius:2px;">
      DISMISS
    </button>
  `;

  const overlay = document.createElement("div");
  overlay.id = "qr-overlay";
  overlay.style.cssText = `position:fixed; inset:0; z-index:9998; background:rgba(0,0,0,0.5);`;
  overlay.onclick = () => {
    modal.remove();
    overlay.remove();
  };

  document.body.appendChild(overlay);
  document.body.appendChild(modal);
}

async function showQR() {
  if (ipcRenderer) {
    const { qrDataUrl, url } = await ipcRenderer.invoke("get-qr");
    showQRModal(qrDataUrl, url);
    const img = document.getElementById("sidebar-qr-image");
    const placeholder = document.getElementById("sidebar-qr-placeholder");
    const urlLabel = document.getElementById("sidebar-qr-url");
    if (img) {
      img.src = qrDataUrl;
      img.style.display = "block";
      if (placeholder) placeholder.style.display = "none";
    }
    if (urlLabel) urlLabel.textContent = url;
  }
}

// ── LOGIN ──
const CREDENTIALS = { admin: "ares2024", operator: "ares1234", guest: "view" };

function handleLogin() {
  const user = document.getElementById("username").value.trim();
  const pass = document.getElementById("password").value.trim();
  const err = document.getElementById("login-error");

  if (CREDENTIALS[user] && CREDENTIALS[user] === pass) {
    err.textContent = "";
    document.getElementById("sidebar-username").textContent =
      user.toUpperCase();
    document.getElementById("login-screen").classList.remove("active");
    document.getElementById("main-app").classList.add("active");
    initApp();
  } else {
    err.textContent = "Invalid credentials. Access denied.";
    document.getElementById("password").value = "";
  }
}

document.addEventListener("keydown", (e) => {
  if (
    e.key === "Enter" &&
    document.getElementById("login-screen").classList.contains("active")
  ) {
    handleLogin();
  }
});

function handleLogout() {
  document.getElementById("main-app").classList.remove("active");
  document.getElementById("login-screen").classList.add("active");
  document.getElementById("password").value = "";
}

// ── INIT ──
async function initApp() {
  checkApiStatus();
  setInterval(checkApiStatus, 10000);
  loadAlerts();
  loadTrainingHistory();
  loadStackelberg();
}

// ── API STATUS ──
async function checkApiStatus() {
  try {
    const res = await fetch(`${API_BASE}/`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      isApiOnline = true;
      document.getElementById("api-status-dot").className = "status-dot online";
      document.getElementById("api-status-text").textContent = "API Online";
    }
  } catch {
    isApiOnline = false;
    document.getElementById("api-status-dot").className = "status-dot offline";
    document.getElementById("api-status-text").textContent =
      "API Offline (Demo Mode)";
  }
}

// ── NAVIGATION ──
function navigate(page) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));
  document.getElementById(`page-${page}`).classList.add("active");
  document.querySelector(`[data-page="${page}"]`).classList.add("active");

  if (page === "alerts") loadAlerts();
  if (page === "fl-training") loadTrainingHistory();
  if (page === "stackelberg") loadStackelberg();
}

// ── WINDOW CONTROLS ──
function minimizeWindow() {
  if (ipcRenderer) ipcRenderer.send("minimize-window");
}
function maximizeWindow() {
  if (ipcRenderer) ipcRenderer.send("maximize-window");
}
function closeWindow() {
  if (ipcRenderer) ipcRenderer.send("close-window");
}

// ── ALERTS ──
async function loadAlerts() {
  let alerts = [];
  if (isApiOnline) {
    try {
      const res = await fetch(`${API_BASE}/alerts`);
      const data = await res.json();
      alerts = data.alerts || [];
    } catch {
      alerts = DUMMY_ALERTS;
    }
  } else {
    alerts = DUMMY_ALERTS;
  }
  allAlerts = alerts;
  renderAlerts(alerts);
  updateAlertsSummary(alerts);
  updateDashboardAlerts(alerts);
}

function renderAlerts(alerts) {
  const tbody = document.getElementById("alerts-tbody");
  if (!alerts.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="loading-row">No alerts found</td></tr>';
    return;
  }
  tbody.innerHTML = alerts
    .map(
      (a) => `
    <tr>
      <td>#${a.id}</td>
      <td>${new Date(a.timestamp).toLocaleString()}</td>
      <td>${a.client_id}</td>
      <td><span class="event-badge event-${a.event_type}">${a.event_type}</span></td>
      <td class="${getConfClass(a.confidence)}">${(a.confidence * 100).toFixed(1)}%</td>
      <td>${a.time_in_video}</td>
      <td>${a.video || "--"}</td>
    </tr>
  `,
    )
    .join("");
}

function updateAlertsSummary(alerts) {
  const counts = {
    Fighting: 0,
    Theft: 0,
    Vandalism: 0,
    Shooting: 0,
    Arrest: 0,
  };
  alerts.forEach((a) => {
    if (counts[a.event_type] !== undefined) counts[a.event_type]++;
  });

  document.getElementById("sum-total").textContent = alerts.length;
  document.getElementById("sum-fighting").textContent = counts.Fighting;
  document.getElementById("sum-theft").textContent = counts.Theft;
  document.getElementById("sum-vandalism").textContent = counts.Vandalism;
  document.getElementById("sum-shooting").textContent = counts.Shooting;
  document.getElementById("sum-arrest").textContent = counts.Arrest;
  document.getElementById("alerts-badge").textContent = alerts.length;
  document.getElementById("threat-count").textContent = alerts.length;
  document.getElementById("sys-total-alerts").textContent = alerts.length;
}

function updateDashboardAlerts(alerts) {
  if (alerts.length > 0) {
    const latest = alerts[0];
    document.getElementById("alert-banner").classList.remove("hidden");
    document.getElementById("alert-banner-text").textContent =
      `${latest.event_type} detected on ${latest.client_id} at ${latest.time_in_video} — ${(latest.confidence * 100).toFixed(0)}% confidence`;
  }
}

function dismissAlert() {
  document.getElementById("alert-banner").classList.add("hidden");
}

function filterAlerts() {
  const filter = document.getElementById("alert-filter").value;
  const filtered =
    filter === "all"
      ? allAlerts
      : allAlerts.filter((a) => a.event_type === filter);
  renderAlerts(filtered);
}

function getConfClass(conf) {
  if (conf >= 0.8) return "conf-high";
  if (conf >= 0.6) return "conf-med";
  return "conf-low";
}

// ── FL TRAINING ──
async function loadTrainingHistory() {
  let history = [];
  if (ipcRenderer) {
    history = await ipcRenderer.invoke("get-training-history");
  }
  if (!history.length && isApiOnline) {
    try {
      const res = await fetch(`${API_BASE}/training-history`);
      const data = await res.json();
      history = data.history || [];
    } catch {
      history = DUMMY_HISTORY;
    }
  }
  if (!history.length) history = DUMMY_HISTORY;
  renderTrainingCharts(history);
  renderTrainingTable(history);
  updateTrainingMetrics(history);
}

function renderTrainingCharts(history) {
  const labels = history.map((h) => `Round ${h.round}`);
  const accuracies = history.map((h) => h.accuracy);
  const losses = history.map((h) => h.loss);

  const chartDefaults = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        grid: { color: "rgba(15,42,63,0.8)" },
        ticks: {
          color: "#5a8aaa",
          font: { family: "Share Tech Mono", size: 10 },
        },
      },
      y: {
        grid: { color: "rgba(15,42,63,0.8)" },
        ticks: {
          color: "#5a8aaa",
          font: { family: "Share Tech Mono", size: 10 },
        },
      },
    },
  };

  if (accuracyChart) accuracyChart.destroy();
  accuracyChart = new Chart(document.getElementById("accuracy-chart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data: accuracies,
          borderColor: "#00ff9d",
          backgroundColor: "rgba(0,255,157,0.1)",
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: "#00ff9d",
          pointRadius: 4,
        },
      ],
    },
    options: { ...chartDefaults },
  });

  if (lossChart) lossChart.destroy();
  lossChart = new Chart(document.getElementById("loss-chart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data: losses,
          borderColor: "#ff3860",
          backgroundColor: "rgba(255,56,96,0.1)",
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: "#ff3860",
          pointRadius: 4,
        },
      ],
    },
    options: { ...chartDefaults },
  });

  renderReputationChart();
}

function renderTrainingTable(history) {
  const tbody = document.getElementById("fl-tbody");
  let prevAcc = null;
  tbody.innerHTML = history
    .map((h) => {
      const improvement =
        prevAcc !== null ? (h.accuracy - prevAcc).toFixed(2) : "--";
      const impClass =
        improvement > 0 ? "success" : improvement < 0 ? "danger" : "";
      const isBest = h.accuracy === Math.max(...history.map((x) => x.accuracy));
      prevAcc = h.accuracy;
      return `
      <tr>
        <td>${h.round}</td>
        <td class="${isBest ? "success" : ""}">${h.accuracy}%${isBest ? " ★" : ""}</td>
        <td>${h.loss}</td>
        <td class="${impClass}">${improvement !== "--" ? (improvement > 0 ? "+" : "") + improvement + "%" : "--"}</td>
        <td><span class="event-badge ${isBest ? "event-Arrest" : "event-person"}">${isBest ? "BEST" : "COMPLETE"}</span></td>
      </tr>`;
    })
    .join("");
}

function updateTrainingMetrics(history) {
  if (!history.length) return;
  const best = Math.max(...history.map((h) => h.accuracy));
  const last = history[history.length - 1];
  const first = history[0];
  const improvement = (best - first.accuracy).toFixed(1);

  document.getElementById("fl-rounds").textContent = history.length;
  document.getElementById("fl-best-acc").textContent = `${best}%`;
  document.getElementById("fl-final-loss").textContent = last.loss.toFixed(4);
  document.getElementById("fl-improvement").textContent = `+${improvement}%`;
  document.getElementById("dashboard-accuracy").textContent = `${best}%`;
  document.getElementById("sys-accuracy").textContent = `${best}%`;
}

// ── STACKELBERG ──
function loadStackelberg() {
  updateReputationCards(DUMMY_REPUTATION);
  renderReputationChart(DUMMY_REPUTATION);
}

function updateReputationCards(repData) {
  repData.forEach((client, i) => {
    const rep = client.reputation;
    const pct = (rep * 100).toFixed(0);
    const bar = document.getElementById(`rep-bar-${i}`);
    const val = document.getElementById(`rep-val-${i}`);
    const rounds = document.getElementById(`node-rounds-${i}`);
    const badge = document.querySelector(`#node-card-${i} .node-badge`);
    const card = document.getElementById(`node-card-${i}`);

    if (bar) bar.style.width = `${pct}%`;
    if (val) val.textContent = rep.toFixed(3);
    if (rounds) rounds.textContent = client.rounds_participated;
    if (rep >= 0.8 && card) card.classList.add("top-performer");
    if (rep >= 0.6 && badge) {
      badge.textContent = "SELECTED";
      badge.className = "node-badge selected";
    } else if (badge) {
      badge.textContent = "LOW REP";
      badge.className = "node-badge";
    }
  });
}

function renderReputationChart(repData = DUMMY_REPUTATION) {
  const canvas = document.getElementById("reputation-chart");
  if (!canvas) return;
  if (reputationChart) reputationChart.destroy();
  reputationChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: ["Client 0", "Client 1", "Client 2"],
      datasets: [
        {
          label: "Reputation Score",
          data: repData.map((r) => r.reputation),
          backgroundColor: repData.map((r) =>
            r.reputation >= 0.8
              ? "rgba(0,255,157,0.6)"
              : r.reputation >= 0.5
                ? "rgba(255,189,46,0.6)"
                : "rgba(255,56,96,0.6)",
          ),
          borderColor: repData.map((r) =>
            r.reputation >= 0.8
              ? "#00ff9d"
              : r.reputation >= 0.5
                ? "#ffbd2e"
                : "#ff3860",
          ),
          borderWidth: 1,
          borderRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { color: "rgba(15,42,63,0.8)" },
          ticks: {
            color: "#5a8aaa",
            font: { family: "Share Tech Mono", size: 10 },
          },
        },
        y: {
          min: 0,
          max: 1,
          grid: { color: "rgba(15,42,63,0.8)" },
          ticks: {
            color: "#5a8aaa",
            font: { family: "Share Tech Mono", size: 10 },
          },
        },
      },
    },
  });
}

// ── CLIENT/SERVER MANAGER ──
function startServer() {
  if (ipcRenderer) {
    ipcRenderer.send("start-fl-server");
    setServerStatus(true);
    addTerminalLine("Starting FL Server on port 8085...", "success");
  } else {
    addTerminalLine("Electron not available. Run from desktop app.", "error");
  }
}

function stopServer() {
  if (ipcRenderer) {
    ipcRenderer.send("stop-fl-server");
    setServerStatus(false);
  }
}

function setServerStatus(online) {
  const pill = document.getElementById("server-status-pill");
  const startBtn = document.getElementById("server-start-btn");
  const stopBtn = document.getElementById("server-stop-btn");
  const flStatusDash = document.getElementById("fl-status-dash");

  pill.textContent = online ? "ONLINE" : "OFFLINE";
  pill.className = online ? "status-pill online" : "status-pill";
  startBtn.disabled = online;
  stopBtn.disabled = !online;
  if (flStatusDash) flStatusDash.textContent = online ? "Running" : "Standby";
}

function showVideoOnDashboard(clientId, filePath) {
  const video = document.getElementById(`video-${clientId}`);
  const placeholder = document.querySelector(
    `#cam-${clientId} .cam-placeholder`,
  );
  const camCard = document.getElementById(`cam-${clientId}`);

  if (video) {
    const cleanPath = filePath.replace(/\\/g, "/");
    video.src = `file:///${cleanPath}`;
    video.classList.remove("hidden");
    video.load();
    if (placeholder) placeholder.style.display = "none";
    if (camCard) camCard.style.borderColor = "var(--accent)";
    const filename = filePath.split(/[\\/]/).pop();
    document.getElementById(`cam-${clientId}-detections`).textContent =
      filename;
  }
}

// ── SELECT FOOTAGE / RTSP SOURCE ──
async function selectClientFootage(clientId) {
  let filePath = await ipcRenderer.invoke("select-video");

  if (!filePath) {
    // File picker was cancelled — show custom modal instead
    showSourcePrompt(clientId);
    return;
  }

  clientFootagePaths[clientId] = filePath;
  document.getElementById(`client-path-${clientId}`).textContent = filePath;
  document.getElementById(`client-path-${clientId}`).style.color =
    "var(--accent)";
  showVideoOnDashboard(clientId, filePath);
}

function startClient(clientId) {
  const videoPath = clientFootagePaths[clientId];
  if (!videoPath) {
    addTerminalLine(`Select footage for Client ${clientId} first`, "error");
    return;
  }
  if (ipcRenderer) {
    ipcRenderer.send("start-fl-client", { clientId, videoPath });
    setClientStatus(clientId, true);
    addTerminalLine(
      `Client ${clientId} starting with ${videoPath.split(/[\\/]/).pop()}`,
      "success",
    );
  } else {
    addTerminalLine("Electron not available. Run from desktop app.", "error");
  }
}

function stopClient(clientId) {
  if (ipcRenderer) {
    ipcRenderer.send("stop-fl-client", clientId);
    ipcRenderer.send("stop-stream-server", clientId);
    setClientStatus(clientId, false);
  }
}

function setClientStatus(clientId, online) {
  const pill = document.getElementById(`client-pill-${clientId}`);
  const startBtn = document.getElementById(`client-start-${clientId}`);
  const stopBtn = document.getElementById(`client-stop-${clientId}`);

  if (pill) {
    pill.textContent = online ? "ONLINE" : "OFFLINE";
    pill.className = online ? "status-pill online" : "status-pill";
  }
  if (startBtn) startBtn.disabled = online;
  if (stopBtn) stopBtn.disabled = !online;
}

function addTerminalLine(msg, type = "") {
  const terminal = document.getElementById("terminal-output");
  if (!terminal) return;
  const lines = msg
    .toString()
    .split("\n")
    .filter((l) => l.trim());
  lines.forEach((l) => {
    const div = document.createElement("div");
    div.className = `term-line ${type ? "term-" + type : ""}`;
    div.innerHTML = `<span class="term-prompt">ARES $</span> ${l}`;
    terminal.appendChild(div);
  });
  terminal.scrollTop = terminal.scrollHeight;
}

function clearTerminal() {
  document.getElementById("terminal-output").innerHTML =
    '<div class="term-line"><span class="term-prompt">ARES $</span> Terminal cleared.</div>';
}

// ── VIDEO UPLOAD ──
async function uploadForClient(clientId) {
  // If this client already has a live source set, re-run detection on it
  const existing = clientFootagePaths[clientId];
  if (
    existing &&
    (existing.startsWith("rtsp") ||
      existing.startsWith("http") ||
      existing.trim() === "0")
  ) {
    _runLiveDetection(clientId, existing);
    return;
  }

  let filePath = null;
  let file = null;

  if (ipcRenderer) {
    filePath = await ipcRenderer.invoke("select-video");
    if (!filePath) {
      // ── Cancelled file picker → show RTSP prompt instead ──
      showUploadSourcePrompt(clientId);
      return;
    }
  } else {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.click();
    await new Promise((res) => {
      input.onchange = () => {
        file = input.files[0];
        res();
      };
    });
    if (!file) {
      showUploadSourcePrompt(clientId);
      return;
    }
  }

  _runFileUpload(clientId, filePath, file);
}

async function _runFileUpload(clientId, filePath, file) {
  const statusDiv = document.getElementById(`upload-status-${clientId}`);
  const fillBar = document.getElementById(`upload-fill-${clientId}`);
  const resultDiv = document.getElementById(`upload-result-${clientId}`);
  const zone = document.getElementById(`upload-zone-${clientId}`);

  statusDiv.classList.remove("hidden");
  zone.style.opacity = "0.5";
  resultDiv.textContent = "Processing footage...";

  let progress = 0;
  const interval = setInterval(() => {
    progress = Math.min(progress + Math.random() * 15, 90);
    fillBar.style.width = `${progress}%`;
  }, 300);

  try {
    let alerts = [];
    if (isApiOnline) {
      const formData = new FormData();
      if (file) {
        formData.append("file", file);
      } else {
        const fs = require("fs");
        const path = require("path");
        formData.append(
          "file",
          new Blob([fs.readFileSync(filePath)]),
          path.basename(filePath),
        );
      }
      const res = await fetch(`${API_BASE}/upload-video/client${clientId}`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      alerts = data.alerts || [];
    } else {
      await new Promise((r) => setTimeout(r, 2000));
      alerts = DUMMY_ALERTS.filter((_, i) => i < 3);
    }

    clearInterval(interval);
    fillBar.style.width = "100%";
    const filename = filePath
      ? filePath.split(/[\\/]/).pop()
      : file
        ? file.name
        : "video";
    resultDiv.innerHTML = `<span style="color:var(--accent)">✓ ${alerts.length} detections found in ${filename}</span>`;
    if (filePath) showVideoOnDashboard(clientId, filePath);
    document.getElementById(`cam-${clientId}-detections`).textContent =
      `${alerts.length} detections`;
    renderDetectionLog(alerts, clientId);
    loadAlerts();
  } catch (err) {
    clearInterval(interval);
    resultDiv.innerHTML = `<span style="color:var(--danger)">⚠ Error: ${err.message}</span>`;
  }

  zone.style.opacity = "1";
}

function showUploadSourcePrompt(clientId) {
  document.getElementById("source-modal")?.remove();

  const modal = document.createElement("div");
  modal.id = "source-modal";
  modal.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.75);
    display: flex; align-items: center; justify-content: center;
  `;
  modal.innerHTML = `
    <div style="background:#0a1520; border:1px solid #00ff9d; border-radius:4px;
                padding:28px; width:480px; font-family:'Share Tech Mono',monospace;">
      <div style="font-size:11px; color:#5a8aaa; letter-spacing:2px; margin-bottom:6px;">
        NO FILE SELECTED — NODE 0${clientId + 1} / CLIENT ${clientId}
      </div>
      <div style="font-size:13px; color:#e0f0ff; margin-bottom:18px; letter-spacing:1px;">
        Enter a live camera source instead
      </div>
      <input id="source-input" placeholder="rtsp://192.168.1.x:554/stream  or  http://192.168.1.x:8080/video  or  0"
        style="width:100%; background:#050a0f; border:1px solid #1a4060;
               color:#e0f0ff; padding:11px 13px; border-radius:2px;
               font-family:'Share Tech Mono',monospace; font-size:12px;
               outline:none; box-sizing:border-box;" />
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <span style="font-size:10px; color:#2a4a60; padding:3px 8px; border:1px solid #0f2a3f; border-radius:2px; cursor:pointer;"
          onclick="document.getElementById('source-input').value='rtsp://192.168.1.16:554/stream'">
          📡 DVR RTSP
        </span>
        <span style="font-size:10px; color:#2a4a60; padding:3px 8px; border:1px solid #0f2a3f; border-radius:2px; cursor:pointer;"
          onclick="document.getElementById('source-input').value='http://192.168.1.5:8080/video'">
          📱 IP Webcam
        </span>
        <span style="font-size:10px; color:#2a4a60; padding:3px 8px; border:1px solid #0f2a3f; border-radius:2px; cursor:pointer;"
          onclick="document.getElementById('source-input').value='0'">
          🎥 USB Webcam
        </span>
      </div>
      <div style="display:flex; gap:10px; margin-top:20px;">
        <button onclick="confirmUploadSource(${clientId})"
          style="flex:1; background:transparent; border:1px solid #00ff9d;
                 color:#00ff9d; padding:11px; cursor:pointer;
                 font-family:'Share Tech Mono',monospace; font-size:12px;
                 letter-spacing:2px; border-radius:2px;">
          ▶ START LIVE DETECTION
        </button>
        <button onclick="document.getElementById('source-modal').remove()"
          style="background:transparent; border:1px solid #0f2a3f;
                 color:#5a8aaa; padding:11px 20px; cursor:pointer;
                 font-family:'Share Tech Mono',monospace; font-size:12px;
                 border-radius:2px;">
          CANCEL
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  setTimeout(() => document.getElementById("source-input")?.focus(), 50);
  document.getElementById("source-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmUploadSource(clientId);
  });
}

function confirmUploadSource(clientId) {
  const input = document.getElementById("source-input");
  const source = input?.value.trim();
  document.getElementById("source-modal")?.remove();
  if (!source) return;

  // Store so re-clicking the upload zone re-runs detection
  clientFootagePaths[clientId] = source;

  // Show live badge on dashboard camera card
  const feedDiv = document.querySelector(`#cam-${clientId} .cam-feed`);
  const placeholder = document.querySelector(
    `#cam-${clientId} .cam-placeholder`,
  );
  const camCard = document.getElementById(`cam-${clientId}`);

  if (feedDiv) {
    feedDiv.querySelector("img.live-feed")?.remove();
    feedDiv.querySelector(".live-badge")?.remove();

    if (source.startsWith("http")) {
      // HTTP streams (IP Webcam) render directly in <img>
      const img = document.createElement("img");
      img.className = "live-feed";
      img.src = source;
      img.style.cssText =
        "width:100%;height:100%;object-fit:cover;display:block;";
      img.onerror = () => showLiveBadge(feedDiv, source);
      if (placeholder) placeholder.style.display = "none";
      feedDiv.appendChild(img);
    } else {
      // RTSP / webcam index — browser can't render, show badge
      showLiveBadge(feedDiv, source);
      if (placeholder) placeholder.style.display = "none";
    }

    if (camCard) camCard.style.borderColor = "var(--accent)";
  }

  // ── Run detection through the upload pipeline ──
  _runLiveDetection(clientId, source);
}

function showLiveBadge(feedDiv, source) {
  feedDiv.querySelector(".live-badge")?.remove();
  const badge = document.createElement("div");
  badge.className = "live-badge";
  badge.style.cssText = `
    position:absolute; inset:0; display:flex; flex-direction:column;
    align-items:center; justify-content:center; background:#020508;
  `;
  badge.innerHTML = `
    <div style="font-size:32px; margin-bottom:10px;">📡</div>
    <div style="font-family:'Share Tech Mono',monospace; font-size:12px;
                color:var(--accent); letter-spacing:3px; margin-bottom:6px;">LIVE STREAM</div>
    <div style="font-family:'Share Tech Mono',monospace; font-size:9px;
                color:var(--text-secondary); max-width:180px; text-align:center;
                word-break:break-all;">${source}</div>
  `;
  feedDiv.appendChild(badge);
}

function renderDetectionLog(alerts, clientId) {
  const log = document.getElementById("upload-detections");
  if (!alerts.length) {
    log.innerHTML =
      '<div class="detection-empty">No anomalies detected in footage</div>';
    return;
  }
  log.innerHTML = alerts
    .slice(0, 20)
    .map(
      (a) => `
    <div class="detection-item">
      <span class="detection-time">${a.time_in_video || "--"}</span>
      <span class="detection-node">client${clientId}</span>
      <span class="event-badge event-${a.event_type}">${a.event_type}</span>
      <span class="detection-conf">${(a.confidence * 100).toFixed(0)}%</span>
    </div>
  `,
    )
    .join("");
}

async function _runLiveDetection(clientId, source) {
  const statusDiv = document.getElementById(`upload-status-${clientId}`);
  const fillBar = document.getElementById(`upload-fill-${clientId}`);
  const resultDiv = document.getElementById(`upload-result-${clientId}`);
  const zone = document.getElementById(`upload-zone-${clientId}`);
  const detLabel = document.getElementById(`cam-${clientId}-detections`);

  // Update dashboard cam footer
  if (detLabel) detLabel.textContent = "📡 Detecting...";

  // Also update the upload card UI so the user can see progress there too
  if (statusDiv) statusDiv.classList.remove("hidden");
  if (zone) zone.style.opacity = "0.5";
  if (resultDiv) resultDiv.textContent = `Processing live source: ${source}`;

  let progress = 0;
  const interval = setInterval(() => {
    progress = Math.min(progress + Math.random() * 10, 90);
    if (fillBar) fillBar.style.width = `${progress}%`;
  }, 400);

  try {
    let alerts = [];

    if (isApiOnline) {
      const res = await fetch(
        `${API_BASE}/start-live-detection/client${clientId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source, max_frames: 300 }),
        },
      );
      const data = await res.json();
      alerts = data.alerts || [];
    } else {
      // Demo mode fallback
      await new Promise((r) => setTimeout(r, 2000));
      alerts = DUMMY_ALERTS.filter((_, i) => i < 3);
    }

    clearInterval(interval);
    if (fillBar) fillBar.style.width = "100%";

    const count = alerts.length;
    const label = count > 0 ? `🚨 ${count} detections` : "📡 Live — No threats";
    if (detLabel) detLabel.textContent = label;
    if (resultDiv)
      resultDiv.innerHTML = `<span style="color:var(--accent)">✓ ${count} detections found on ${source}</span>`;

    renderDetectionLog(alerts, clientId);
    loadAlerts();
  } catch (err) {
    clearInterval(interval);
    if (detLabel) detLabel.textContent = "⚠ Detection error";
    if (resultDiv)
      resultDiv.innerHTML = `<span style="color:var(--danger)">⚠ Error: ${err.message}</span>`;
  }

  if (zone) zone.style.opacity = "1";
}

function confirmSource(clientId) {
  const input = document.getElementById("source-input");
  const filePath = input?.value.trim();
  document.getElementById("source-modal")?.remove();
  if (!filePath) return;

  clientFootagePaths[clientId] = filePath;
  document.getElementById(`client-path-${clientId}`).textContent = filePath;
  document.getElementById(`client-path-${clientId}`).style.color =
    "var(--accent)";

  const isLive =
    filePath.startsWith("rtsp") ||
    filePath.startsWith("http") ||
    filePath.trim() === "0";

  if (isLive) {
    // ── Show live feed visually on dashboard ──
    const feedDiv = document.querySelector(`#cam-${clientId} .cam-feed`);
    const placeholder = document.querySelector(
      `#cam-${clientId} .cam-placeholder`,
    );
    const camCard = document.getElementById(`cam-${clientId}`);

    if (feedDiv) {
      feedDiv.querySelector("img.live-feed")?.remove();

      const img = document.createElement("img");
      img.className = "live-feed";
      img.style.cssText =
        "width:100%;height:100%;object-fit:cover;display:block;";
      img.src = filePath; // HTTP streams load directly; RTSP won't render but detection still runs
      img.onerror = () => {
        // RTSP can't render in browser — show a "live" placeholder instead
        img.style.display = "none";
        const badge = document.createElement("div");
        badge.style.cssText = `
          position:absolute; inset:0; display:flex; flex-direction:column;
          align-items:center; justify-content:center; background:#020508;
        `;
        badge.innerHTML = `
          <div style="font-size:28px; margin-bottom:8px;">📡</div>
          <div style="font-family:'Share Tech Mono',monospace; font-size:11px;
                      color:var(--accent); letter-spacing:2px;">LIVE STREAM</div>
          <div style="font-family:'Share Tech Mono',monospace; font-size:10px;
                      color:var(--text-secondary); margin-top:4px;">${filePath}</div>
        `;
        feedDiv.appendChild(badge);
      };

      if (placeholder) placeholder.style.display = "none";
      feedDiv.appendChild(img);
      if (camCard) camCard.style.borderColor = "var(--accent)";
    }

    // ── Run detection via upload pipeline (same as uploadForClient) ──
    _runLiveDetection(clientId, filePath);
  } else {
    // Pre-recorded file path — show on dashboard directly
    showVideoOnDashboard(clientId, filePath);
  }
}
