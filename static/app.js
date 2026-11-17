const DEFAULT_CODES = ["688605"];
const STORAGE = {
  list: "kdj_watchlist_v2",
  settings: "kdj_settings_v2",
  seen: "kdj_seen_alerts_v2",
};

const els = {
  board: document.getElementById("board"),
  form: document.getElementById("add-form"),
  input: document.getElementById("code-input"),
  suggest: document.getElementById("suggest"),
  clock: document.getElementById("clock"),
  ruleText: document.getElementById("rule-text"),
  ob: document.getElementById("ob-input"),
  os: document.getElementById("os-input"),
  interval: document.getElementById("interval-input"),
  alertBtn: document.getElementById("alert-btn"),
  demoBtn: document.getElementById("demo-btn"),
  refreshBtn: document.getElementById("refresh-btn"),
  modal: document.getElementById("modal"),
  modalCard: document.querySelector(".modal-card"),
  badge: document.getElementById("modal-badge"),
  title: document.getElementById("modal-title"),
  period: document.getElementById("modal-period"),
  k: document.getElementById("modal-k"),
  d: document.getElementById("modal-d"),
  j: document.getElementById("modal-j"),
  rule: document.getElementById("modal-rule"),
  note: document.getElementById("modal-note"),
  ok: document.getElementById("modal-ok"),
};

let settings = loadSettings();
let watchlist = loadWatchlist();
let seen = loadSeen();
let audioCtx = null;
let suggestTimer = null;
let pollTimer = null;
let queue = [];
let modalOpen = false;
let lastItems = [];
let alarmTimer = null;
let alarmNodes = [];

function loadWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE.list) || "[]");
    if (Array.isArray(saved) && saved.length) return [...new Set(saved)];
  } catch (_) {}
  return [...DEFAULT_CODES];
}

function loadSettings() {
  const def = { ob: 98, os: 2, interval: 15, alertOn: true };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(STORAGE.settings) || "{}") };
  } catch (_) {
    return def;
  }
}

function loadSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE.seen) || "[]"));
  } catch (_) {
    return new Set();
  }
}

function persistLocal() {
  localStorage.setItem(STORAGE.list, JSON.stringify(watchlist));
  localStorage.setItem(STORAGE.settings, JSON.stringify(settings));
  localStorage.setItem(STORAGE.seen, JSON.stringify([...seen].slice(-400)));
}

function persist() {
  persistLocal();
  fetch("/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codes: watchlist }),
  }).catch(() => {});
}

function applySettingsToForm() {
  els.ob.value = settings.ob;
  els.os.value = settings.os;
  els.interval.value = settings.interval;
  els.alertBtn.textContent = settings.alertOn ? "关闭提醒" : "开启提醒";
  els.alertBtn.classList.toggle("on", settings.alertOn);
  els.ruleText.textContent = `日线 / 15分钟 / 5分钟 · J>${settings.ob} 且 K>D 超买 · J<${settings.os} 且 K<D 超卖`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "--";
  return Number(n).toFixed(digits);
}

function signed(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "--";
  const v = Number(n);
  return (v > 0 ? "+" : "") + v.toFixed(digits);
}

function tickClock() {
  els.clock.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function ensureAudio() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function stopAlarm() {
  if (alarmTimer) {
    clearInterval(alarmTimer);
    alarmTimer = null;
  }
  alarmNodes.forEach((node) => {
    try { node.stop(); } catch (_) {}
  });
  alarmNodes = [];
}

function beepOnce(type) {
  try {
    const ctx = ensureAudio();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.type = "square";
    osc2.type = "square";
    osc1.frequency.value = type === "overbought" ? 880 : 740;
    osc2.frequency.value = type === "overbought" ? 1175 : 988;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.42, now + 0.02);
    gain.gain.setValueAtTime(0.42, now + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.34);
    osc2.stop(now + 0.34);
    alarmNodes.push(osc1, osc2);
  } catch (_) {}
}

function startAlarm(type) {
  stopAlarm();
  let count = 0;
  const play = () => {
    count += 1;
    beepOnce(type);
    if (count >= 3) stopAlarm();
  };
  play();
  alarmTimer = setInterval(play, 480);
}

function notifyBrowser(item) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(`${item.title} ${item.code}`, {
      body: `${item.periodLabel} · ${item.rule}`,
    });
  } catch (_) {}
}

function sparkline(series) {
  const w = 360, h = 78, pad = 6;
  if (!series || series.length < 2) {
    return `<svg class="chart" viewBox="0 0 ${w} ${h}"></svg>`;
  }
  const vals = series.flatMap((x) => [x.k, x.d, x.j]);
  let min = Math.min(...vals, 0);
  let max = Math.max(...vals, 100);
  if (max === min) max = min + 1;
  const x = (i) => pad + (i * (w - pad * 2)) / (series.length - 1);
  const y = (v) => pad + ((max - v) * (h - pad * 2)) / (max - min);
  const path = (key) => series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path d="${path("k")}" fill="none" stroke="#f0c14b" stroke-width="1.8"/>
    <path d="${path("d")}" fill="none" stroke="#4ec4ff" stroke-width="1.8"/>
    <path d="${path("j")}" fill="none" stroke="#ff8a4a" stroke-width="1.8"/>
  </svg>`;
}

function judge(latest) {
  if (!latest) return null;
  const k = Number(latest.k), d = Number(latest.d), j = Number(latest.j);
  if (j > settings.ob && k > d) {
    return {
      type: "overbought",
      title: "超买提醒",
      rule: `J=${fmt(j)} > ${settings.ob} 且 K>D`,
    };
  }
  if (j < settings.os && k < d) {
    return {
      type: "oversold",
      title: "超卖提醒",
      rule: `J=${fmt(j)} < ${settings.os} 且 K<D`,
    };
  }
  return null;
}

function alertKey(code, period, time, type) {
  return `${code}|${period}|${time}|${type}`;
}

function showModal(payload, demo = false) {
  modalOpen = true;
  const oversold = payload.type === "oversold";
  els.modal.classList.remove("hidden");
  els.modalCard.classList.toggle("ob", !oversold);
  els.badge.className = `modal-badge ${oversold ? "os" : "ob"}`;
  els.badge.textContent = demo ? `${payload.title}（演示）` : payload.title;
  els.title.textContent = `${payload.name} ${payload.code}`;
  els.period.textContent = `${payload.periodLabel} KDJ`;
  els.k.textContent = fmt(payload.k);
  els.d.textContent = fmt(payload.d);
  els.j.textContent = fmt(payload.j);
  els.rule.textContent = payload.rule;
  els.note.textContent = demo
    ? "这是演示弹窗。真实触发时会同样居中弹出，并伴随提示音。"
    : "同一根 K 线只提醒一次。";
}

function closeModal() {
  stopAlarm();
  els.modal.classList.add("hidden");
  modalOpen = false;
  if (queue.length) {
    const next = queue.shift();
    fireAlert(next, false);
  }
}

function fireAlert(payload, demo) {
  if (!demo && !settings.alertOn) return;
  startAlarm(payload.type);
  if (!demo) notifyBrowser(payload);
  showModal(payload, demo);
}

function enqueueAlerts(items) {
  if (!settings.alertOn) return;
  items.forEach((item) => {
    ["day", "m15", "m5"].forEach((key) => {
      const p = item.periods[key] || {};
      const latest = p.latest;
      const sig = judge(latest);
      if (!latest || !sig) return;
      const keyId = alertKey(item.code, key, latest.time, sig.type);
      if (seen.has(keyId)) return;
      seen.add(keyId);
      const payload = {
        ...sig,
        name: item.name,
        code: item.code,
        periodLabel: p.label,
        k: latest.k,
        d: latest.d,
        j: latest.j,
      };
      if (modalOpen) queue.push(payload);
      else fireAlert(payload, false);
    });
  });
  persist();
}

function panelHtml(p) {
  const latest = p.latest || {};
  const sig = judge(latest);
  const cls = sig ? sig.type : "";
  const state = sig ? (sig.type === "oversold" ? "超卖" : "超买") : "观察中";
  const stateCls = sig ? (sig.type === "oversold" ? "os" : "ob") : "";
  const note = sig
    ? `${latest.time || ""} 收盘 ${fmt(latest.close)} ${sig.rule}`
    : `${latest.time || "--"} 收盘 ${fmt(latest.close)} 未触发提醒条件`;
  return `
    <div class="panel ${cls}">
      <div class="panel-top">
        <strong>${escapeHtml(p.label || "")}</strong>
        <span class="state ${stateCls}">${escapeHtml(p.error || state)}</span>
      </div>
      <div class="kdj">
        <div><b>K</b><span>${fmt(latest.k)}</span></div>
        <div><b>D</b><span>${fmt(latest.d)}</span></div>
        <div><b>J</b><span>${fmt(latest.j)}</span></div>
      </div>
      <div class="note" title="${escapeHtml(p.error || note)}">${escapeHtml(p.error || note)}</div>
      ${sparkline(p.series)}
    </div>`;
}

function render(items) {
  lastItems = items;
  if (!items.length) {
    els.board.innerHTML = `<div class="empty">暂无监控标的</div>`;
    return;
  }
  els.board.innerHTML = items.map((item) => {
    const q = item.quote || {};
    const pct = q.change_pct;
    const color = pct > 0 ? "up" : pct < 0 ? "down" : "";
    const hit = ["day", "m15", "m5"].some((k) => judge((item.periods[k] || {}).latest));
    return `
      <article class="card ${hit ? "hit" : ""}">
        <div class="head">
          <div>
            <div class="name">${escapeHtml(item.name)}</div>
            <div class="code">${escapeHtml(item.code)}</div>
            <div class="quote">开 ${fmt(q.open)}　高 ${fmt(q.high)}　低 ${fmt(q.low)}　换手 ${fmt(q.turnover)}%</div>
          </div>
          <div class="right">
            <div class="price ${color}">${fmt(q.price)}</div>
            <div class="chg ${color}">${signed(q.change)} / ${signed(pct)}%</div>
            <button class="remove" data-remove="${item.code}">移除</button>
          </div>
        </div>
        <div class="periods">
          ${panelHtml(item.periods.day || { label: "日线" })}
          ${panelHtml(item.periods.m15 || { label: "15分钟" })}
          ${panelHtml(item.periods.m5 || { label: "5分钟" })}
        </div>
      </article>`;
  }).join("");
}

function renderSuggest(items) {
  if (!items.length) {
    els.suggest.classList.add("hidden");
    els.suggest.innerHTML = "";
    return;
  }
  els.suggest.classList.remove("hidden");
  els.suggest.innerHTML = items
    .map((x) => `<div data-code="${escapeHtml(x.code)}">${escapeHtml(x.code)} ${escapeHtml(x.name)}</div>`)
    .join("");
}

async function search(q) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  return data.items || [];
}

function addCode(code) {
  const cleaned = String(code || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (!cleaned) return;
  if (!watchlist.includes(cleaned)) watchlist.push(cleaned);
  persist();
  refresh();
}

function removeCode(code) {
  const target = String(code || "").toUpperCase();
  watchlist = watchlist.filter((x) => String(x).toUpperCase() !== target);
  persist();
  refresh();
}

function restartPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refresh, Math.max(5, Number(settings.interval) || 15) * 1000);
}

async function refresh() {
  try {
    const res = await fetch(`/api/monitor?codes=${encodeURIComponent(watchlist.join(","))}`);
    const data = await res.json();
    const items = data.items || [];
    if (items.length) {
      watchlist = items.map((x) => String(x.code || "").toUpperCase()).filter(Boolean);
      persistLocal();
    }
    render(items);
    enqueueAlerts(items);
  } catch (_) {}
}

async function bootWatchlist() {
  try {
    const res = await fetch("/api/watchlist");
    const data = await res.json();
    const serverCodes = Array.isArray(data.codes) ? data.codes.map((x) => String(x).toUpperCase()).filter(Boolean) : [];
    const localCodes = loadWatchlist().map((x) => String(x).toUpperCase()).filter(Boolean);
    const merged = [];
    [...serverCodes, ...localCodes].forEach((code) => {
      if (!merged.includes(code)) merged.push(code);
    });
    watchlist = merged.length ? merged : [...DEFAULT_CODES];
    persist();
  } catch (_) {
    persistLocal();
  }
}

function readFormSettings() {
  settings.ob = Number(els.ob.value || 98);
  settings.os = Number(els.os.value || 2);
  settings.interval = Number(els.interval.value || 15);
  persist();
  applySettingsToForm();
  render(lastItems);
  restartPoll();
}

els.input.addEventListener("input", () => {
  const q = els.input.value.trim();
  clearTimeout(suggestTimer);
  if (!q) return renderSuggest([]);
  suggestTimer = setTimeout(async () => {
    try { renderSuggest(await search(q)); } catch (_) { renderSuggest([]); }
  }, 220);
});

els.suggest.addEventListener("click", (e) => {
  const row = e.target.closest("[data-code]");
  if (!row) return;
  addCode(row.dataset.code);
  els.input.value = "";
  renderSuggest([]);
});

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  addCode(els.input.value.trim());
  els.input.value = "";
  renderSuggest([]);
});

els.board.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove]");
  if (btn) removeCode(btn.dataset.remove);
});

els.refreshBtn.addEventListener("click", refresh);
els.ob.addEventListener("change", readFormSettings);
els.os.addEventListener("change", readFormSettings);
els.interval.addEventListener("change", readFormSettings);
els.ok.addEventListener("click", closeModal);

els.alertBtn.addEventListener("click", async () => {
  settings.alertOn = !settings.alertOn;
  if (settings.alertOn && "Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
  persist();
  applySettingsToForm();
});

els.demoBtn.addEventListener("click", () => {
  const item = lastItems[0] || { name: "先锋精科", code: "688605" };
  fireAlert({
    type: "oversold",
    title: "超卖提醒",
    name: item.name || "先锋精科",
    code: item.code || "688605",
    periodLabel: "5分钟",
    k: 17.4,
    d: 27.47,
    j: -2.74,
    rule: `J=-2.74 < ${settings.os} 且 K<D`,
  }, true);
});

document.addEventListener("click", () => { try { ensureAudio(); } catch (_) {} }, { once: true });

applySettingsToForm();
tickClock();
setInterval(tickClock, 1000);
bootWatchlist().finally(() => {
  refresh();
  restartPoll();
});
