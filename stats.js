import { getStore, updateStore } from "./store.js";

function dayKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  return d.toISOString().slice(0, 10);
}

function weekStartKey() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

export async function bumpCounter(name, n = 1) {
  return updateStore(s => {
    s.stats = s.stats || {};
    s.stats[name] = (s.stats[name] || 0) + n;
    s.stats.byDay = s.stats.byDay || {};
    const k = dayKey();
    s.stats.byDay[k] = s.stats.byDay[k] || {};
    s.stats.byDay[k][name] = (s.stats.byDay[k][name] || 0) + n;
    s.stats.lastActivity = new Date().toISOString();
    return s;
  });
}

export async function setLastError(msg) {
  return updateStore(s => {
    s.stats = s.stats || {};
    s.stats.lastError = msg || "";
    s.stats.lastErrorAt = new Date().toISOString();
    return s;
  });
}

export async function setLastStart() {
  return updateStore(s => {
    s.stats = s.stats || {};
    s.stats.lastStart = new Date().toISOString();
    return s;
  });
}

export async function pushEvent(ev) {
  if (!ev || typeof ev !== "object") return;
  return updateStore(s => {
    s.logs = s.logs || [];
    s.logs.unshift({
      ts: new Date().toISOString(),
      dir: ev.dir || "in",
      from: (ev.from || "").slice(0, 20),
      text: (ev.text || "").slice(0, 140),
      kind: ev.kind || "text",
    });
    s.logs = s.logs.slice(0, 100);
    return s;
  });
}

export async function getStats() {
  const s = await getStore();
  const st = s.stats || {};
  const byDay = st.byDay || {};
  const today = byDay[dayKey()] || {};
  const week = { messages: 0, answered: 0, unanswered: 0 };
  for (let off = 0; off < 7; off++) {
    const d = byDay[dayKey(-off)] || {};
    week.messages += d.messages || 0;
    week.answered += d.answered || 0;
    week.unanswered += d.unanswered || 0;
  }
  return {
    total: {
      messages: st.messages || 0,
      chats: st.chats || 0,
      answered: st.answered || 0,
      unanswered: st.unanswered || 0,
      voice: st.voice || 0,
    },
    today,
    week,
    lastStart: st.lastStart || "",
    lastActivity: st.lastActivity || "",
    lastError: st.lastError || "",
    lastErrorAt: st.lastErrorAt || "",
    dailyTarget: st.dailyTarget || "—",
    logs: (s.logs || []).slice(0, 100),
  };
}

const chatSeen = new Set();
export async function trackChat(jid) {
  if (chatSeen.has(jid)) return;
  chatSeen.add(jid);
  if (chatSeen.size % 5 === 0 || chatSeen.size < 3) {
    updateStore(s => { s.stats = s.stats || {}; s.stats.chats = chatSeen.size; return s; }).catch(() => {});
  }
}

export async function ensureSeeded() {
  const s = await getStore();
  const changed = updateStore(s0 => {
    if (!s0.stats) s0.stats = {};
    if (!s0.logs) s0.logs = [];
    return s0;
  });
  await changed;
}