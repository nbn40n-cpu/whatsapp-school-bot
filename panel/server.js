import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getStore, updateStore } from "../store.js";
import { getStats } from "../stats.js";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let control = {
  paused: false,
  pausedAt: null,
  restartRequestedAt: null,
  state: {},
};

export function getControl() {
  return control;
}

export function setPaused(b, at = null) {
  control.paused = !!b;
  control.pausedAt = b ? (at || Date.now()) : null;
  updateStore(s => { s.control = { paused: control.paused, pausedAt: new Date().toISOString() }; }).catch(() => {});
}

export function setPanelState(obj) {
  control.state = { ...(control.state || {}), ...obj };
}

function hashPw(pw, salt) {
  return createHash("sha256").update(pw + "::" + salt).digest("hex");
}

function signToken(data, secret, ttlMs) {
  const payload = Buffer.from(JSON.stringify({ d: data, exp: Date.now() + ttlMs })).toString("base64url");
  const sig = createHash("sha256").update(payload + secret).digest("hex").slice(0, 16);
  return payload + "." + sig;
}

function verifyToken(token, secret) {
  try {
    const [payload, sig] = (token || "").split(".");
    if (!payload || !sig) return null;
    const expect = createHash("sha256").update(payload + secret).digest("hex").slice(0, 16);
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (Date.now() > obj.exp) return null;
    return obj.d;
  } catch (_) {
    return null;
  }
}

export async function startPanel({ getBotState, onControl, onConfigChanged, onNumbersChanged }) {
  const express = (await import("express")).default;
  const app = express();
  const secret = randomBytes(32).toString("hex");
  const port = process.env.PANEL_PORT || process.env.PORT || 4000;
  const password = process.env.PANEL_PASSWORD || "";

  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    res.setHeader("x-content-type-options", "nosniff");
    if (req.path.startsWith("/panel/api/")) res.setHeader("cache-control", "no-store");
    next();
  });

  const isAuthed = (req) => {
    const t = (req.headers.authorization || "").replace(/^Bearer /i, "").trim();
    if (!t) return false;
    const d = verifyToken(t, secret);
    return !!(d && d.role === "admin");
  };

  app.post("/panel/api/login", (req, res) => {
    if (!password) return res.status(500).json({ ok: false, error: "PANEL_PASSWORD غير مضبوط في .env" });
    const pw = String(req.body?.password || "");
    const ok = pw.length === password.length && timingSafeEqual(Buffer.from(pw), Buffer.from(password));
    if (!ok) return res.status(401).json({ ok: false, error: "كلمة المرور غير صحيحة" });
    const token = signToken({ role: "admin" }, secret, 12 * 60 * 60 * 1000);
    res.json({ ok: true, token });
  });

  const auth = (req, res, next) => {
    if (!isAuthed(req)) return res.status(401).json({ ok: false, error: "غير مصرح. سجل دخولك أولاً." });
    next();
  };

  app.get("/panel/api/state", auth, async (req, res) => {
    try {
      const b = getBotState();
      const stats = await getStats();
      const s = await getStore();
      res.json({ ok: true, state: b, stats, control: { paused: control.paused, pausedAt: control.pausedAt }, faq: s.faq || [], categories: s.categories || [], numbers: s.numbers || {}, names: s.names || {}, ai: s.ai || {}, voice: s.voice || {}, school: s.school || {}, prices: s.prices || {}, medical: s.medical || {}, links: s.links || {}, papers: s.papers || {}, licenseFees: s.licenseFees || {} });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/panel/api/control", auth, async (req, res) => {
    const action = String(req.body?.action || "");
    try {
      const out = await onControl(action);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.get("/panel/api/config", auth, async (req, res) => {
    try {
      const s = await getStore();
      res.json({ ok: true, config: s });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.put("/panel/api/config", auth, async (req, res) => {
    try {
      const next = req.body?.config;
      if (!next || typeof next !== "object") return res.status(400).json({ ok: false, error: "config مطلوب" });
      const upd = await updateStore((s) => ({ ...s, ...next }));
      if (onConfigChanged) await onConfigChanged(upd);
      const s = await getStore();
      res.json({ ok: true, config: s });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  const scopedSections = {};
  for (const k of ["school", "ages", "medical", "prices", "papers", "exams", "links", "busCourse", "licenseFees", "trafficSigns", "oralExamRule", "newDriver", "contracts", "names"]) {
    scopedSections[k] = 1;
  }

  app.put("/panel/api/school", auth, async (req, res) => {
    try {
      const body = req.body || {};
      const keys = Object.keys(body);
      if (!keys.length || keys.some((k) => !scopedSections[k])) {
        return res.status(400).json({ ok: false, error: "المفتاح غير مسموح: " + keys.join(",") });
      }
      const upd = await updateStore((s) => {
        for (const k of keys) {
          if (body[k] && typeof body[k] === "object" && !Array.isArray(body[k])) {
            s[k] = { ...(s[k] || {}), ...body[k] };
          } else {
            s[k] = body[k];
          }
        }
        return s;
      });
      if (onConfigChanged) await onConfigChanged(upd);
      const s = await getStore();
      res.json({ ok: true, school: s });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.put("/panel/api/ai", auth, async (req, res) => {
    try {
      const body = req.body || {};
      const s = await getStore();
      const ai = s.ai = s.ai || {};
      if (typeof body.primaryModel === "string" && body.primaryModel.trim()) ai.primaryModel = body.primaryModel.trim();
      if (Array.isArray(body.fallbackModels)) ai.fallbackModels = body.fallbackModels.map(String).filter(Boolean);
      if (typeof body.temperature === "number" && body.temperature >= 0 && body.temperature <= 2) ai.temperature = body.temperature;
      if (typeof body.maxTokens === "number" && body.maxTokens > 0) ai.maxTokens = Math.round(body.maxTokens);
      if (typeof body.whisperModel === "string" && body.whisperModel.trim()) ai.whisperModel = body.whisperModel.trim();
      const voice = s.voice = s.voice || {};
      if (typeof body.voice === "string" && body.voice.trim()) voice.voice = body.voice.trim();
      if (typeof body.rate === "string" && body.rate.trim()) voice.rate = body.rate.trim();
      if (typeof body.pitch === "string" && body.pitch.trim()) voice.pitch = body.pitch.trim();
      if (typeof body.replyToVoice === "boolean") voice.replyToVoice = body.replyToVoice;
      if (typeof body.maxSentences === "number" && body.maxSentences >= 1) voice.maxSentences = Math.round(body.maxSentences);
      const upd = await updateStore(() => s);
      await getStore().then(async () => { if (onConfigChanged) await onConfigChanged(upd); });
      res.json({ ok: true, ai: upd.ai, voice: upd.voice });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.put("/panel/api/numbers", auth, async (req, res) => {
    try {
      const next = req.body || {};
      const pick = (k) => Array.isArray(next[k]) ? next[k].map((x) => String(x).replace(/\D/g, "").trim()).filter((x) => x.length >= 9) : undefined;
      const names = next.names && typeof next.names === "object" ? next.names : undefined;
      if (typeof next !== "object" || !pick("family") && !pick("intimate") && !pick("boss") && !pick("trainers") && !pick("owner") && !names)
        return res.status(400).json({ ok: false, error: "numbers مطلوب" });
      const upd = await updateStore((s) => {
        const n = s.numbers = s.numbers || {};
        if (pick("family") !== undefined) n.family = pick("family");
        if (pick("intimate") !== undefined) n.intimate = pick("intimate");
        if (pick("boss") !== undefined) n.boss = pick("boss");
        if (pick("trainers") !== undefined) n.trainers = pick("trainers");
        if (next.owner) n.owner = String(next.owner).replace(/\D/g, "");
        if (names) s.names = s.names || {}, Object.assign(s.names, names);
        return s;
      });
      if (onNumbersChanged) await onNumbersChanged();
      const s = await getStore();
      res.json({ ok: true, numbers: s.numbers || {}, names: s.names || {} });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  const genId = () => "faq-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e4).toString(36);

  app.post("/panel/api/faq", auth, async (req, res) => {
    try {
      const body = req.body || {};
      const entry = {
        id: genId(),
        managed: true,
        active: body.active !== false,
        category: String(body.category || "الردود العامة"),
        triggers: Array.isArray(body.triggers) ? body.triggers.map(String).filter(Boolean) : [],
        reply: String(body.reply || ""),
        matchMode: body.matchMode || "contains",
      };
      if (!entry.triggers.length || !entry.reply) return res.status(400).json({ ok: false, error: "الكلمات المفتاحية والرد مطلوبان" });
      await updateStore((s) => { (s.faq = s.faq || []).push(entry); return s; });
      res.json({ ok: true, faq: entry });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.put("/panel/api/faq/:id", auth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const body = req.body || {};
      await updateStore((s) => {
        s.faq = s.faq || [];
        const idx = s.faq.findIndex((f) => f.id === id);
        if (idx === -1) throw new Error("الرد غير موجود");
        const cur = s.faq[idx];
        s.faq[idx] = {
          ...cur,
          ...body,
          id,
          managed: true,
          triggers: body.triggers !== undefined ? body.triggers.map(String).filter(Boolean) : cur.triggers,
        };
        return s;
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.delete("/panel/api/faq/:id", auth, async (req, res) => {
    try {
      const id = String(req.params.id);
      await updateStore((s) => { s.faq = (s.faq || []).filter((f) => f.id !== id); return s; });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/panel/api/faq/:id/toggle", auth, async (req, res) => {
    try {
      const id = String(req.params.id);
      await updateStore((s) => {
        const f = (s.faq || []).find((x) => x.id === id);
        if (!f) throw new Error("الرد غير موجود");
        f.active = f.active === false;
        f.managed = true;
        return s;
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  app.get("/panel/api/categories", auth, async (req, res) => {
    try {
      const s = await getStore();
      res.json({ ok: true, categories: s.categories || [] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.put("/panel/api/categories", auth, async (req, res) => {
    try {
      const cats = (req.body?.categories || []).map(String).filter(Boolean);
      await updateStore((s) => { s.categories = cats; return s; });
      res.json({ ok: true, categories: cats });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  const publicDir = path.join(__dirname, "public");
  app.use("/panel", express.static(publicDir, { index: "index.html" }));

  app.get("/panel", (req, res) => res.sendFile(path.join(publicDir, "index.html")));
  app.get("/panel/", (req, res) => res.redirect("/panel"));

  app.get(["/", "/status"], (req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(getBotState()));
  });

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`🖥️ لوحة التحكم على المنفذ ${port}${password ? " (محمية بكلمة مرور)" : " (بدون كلمة مرور!)"}`);
      resolve({ server, port });
    });
    server.on("error", (e) => {
      if (e.code === "EADDRINUSE") {
        console.log(`⚠️ المنفذ ${port} مشغول — لوحة التحكم لم تعمل. غيّر PANEL_PORT.`);
      } else {
        console.error("🖥️ خطأ لوحة التحكم:", e.message);
      }
      resolve({ server: null, port, error: e.message });
    });
  });
}