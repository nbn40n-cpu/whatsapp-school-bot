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

export async function startPanel({ getBotState, onControl }) {
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
      res.json({ ok: true, state: b, stats, control: { paused: control.paused, pausedAt: control.pausedAt } });
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
      await updateStore(() => next);
      const s = await getStore();
      res.json({ ok: true, config: s });
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