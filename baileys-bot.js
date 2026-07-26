import "dotenv/config";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { getAIResponse } from "./ai.js";
import path from "path";
import fs from "fs";

const SCHOOL_NAME = "مدرسة بديع لتعليم السياقة";
const PHONE = process.env.SCHOOL_PHONE || "0568444407";

function fmtPhone(p) {
  let c = p.replace(/\D/g, "");
  if (c.startsWith("0")) c = "972" + c.slice(1);
  return c;
}

function getText(msg) {
  return msg.message?.conversation || msg.message?.extendedTextMessage?.text || null;
}

function isGroup(jid) {
  return jid?.includes("@g.us");
}

const authPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "auth_info")
  : "auth_info";

function serializeState(state) {
  const data = { creds: state.creds, keys: {} };
  for (const [id, key] of state.keys.entries()) {
    data.keys[id] = key;
  }
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

let sock = null;
let retryCount = 0;

async function startBot() {
  if (sock) {
    sock.removeAllListeners();
    sock.end(undefined);
    sock = null;
    await new Promise((r) => setTimeout(r, 2000));
  }

  const savedB64 = process.env.BAILEYS_AUTH_B64;
  if (savedB64) {
    try {
      const data = JSON.parse(Buffer.from(savedB64, "base64").toString());
      ensureDir(authPath);
      fs.writeFileSync(path.join(authPath, "creds.json"), JSON.stringify(data.creds, null, 2));
      console.log("تم استعادة الجلسة من BAILEYS_AUTH_B64");
    } catch (e) {
      console.log("فشل استعادة الجلسة - نبدأ من الصفر");
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  const isRegistered = state.creds?.registered;

  sock = makeWASocket({
    version,
    auth: state,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    connectTimeoutMs: 120000,
    keepAliveIntervalMs: 30000,
    browser: ["Chrome", "122.0.0.0", ""],
  });

  sock.ev.on("creds.update", saveCreds);

  let pairingDone = false;

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr && !pairingDone && !isRegistered) {
      console.log("QR كود ورد - استخدمه إذا ظهر");
    }

    if (connection === "open") {
      pairingDone = true;
      retryCount = 0;
      console.log(SCHOOL_NAME + " - المساعد متصل بالواتساب!");

      try {
        const b64 = serializeState(state);
        console.log("\nBAILEYS_AUTH_B64 (احفظ هذا):");
        console.log(b64);
        console.log("");
      } catch (_) {}
    }

    if (connection === "close") {
      const r = lastDisconnect?.error?.output?.statusCode;
      if (r === DisconnectReason.loggedOut) {
        console.log("تم تسجيل الخروج. امسح BAILEYS_AUTH_B64 وأعد النشر");
        return;
      }
      if (r === DisconnectReason.badSession) {
        console.log("جلسة تالفة. امسح BAILEYS_AUTH_B64 وأعد النشر");
        return;
      }
      retryCount++;
      const delay = Math.min(30000, retryCount * 5000);
      console.log("قطع (" + (r || "?") + "). محاولة " + retryCount + ". إعادة بعد " + (delay / 1000) + " ثانية...");
      sock = null;
      setTimeout(startBot, delay);
    }
  });

  if (!isRegistered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(fmtPhone(PHONE));
        const display = code.match(/.{1,4}/g)?.join("-") || code;
        console.log("\nكود الاقتران: " + display);
        console.log("واتساب > الإعدادات > الأجهزة المرتبطة > ربط جهاز\n");
        pairingDone = true;
      } catch (e) {
        console.log("لم نتمكن من الحصول على كود الاقتران. جرب QR إذا ظهر");
      }
    }, 5000);
  } else {
    console.log("جلسة محفوظة. تسجيل الدخول...");
  }

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.fromMe || isGroup(msg.key.remoteJid)) continue;
      const text = getText(msg);
      if (!text) continue;

      const sender = msg.key.remoteJid;
      if (sender === fmtPhone(PHONE) + "@s.whatsapp.net") {
        console.log("(المالك): " + text);
        continue;
      }

      console.log(sender + ": " + text);

      try {
        await sock.sendPresenceUpdate("composing", sender);
        const reply = await getAIResponse(text);
        await sock.sendPresenceUpdate("paused", sender);
        await sock.sendMessage(sender, { text: reply });
        console.log(reply.slice(0, 60) + "...");
      } catch (err) {
        console.error("خطأ:", err.message);
      }
    }
  });

  console.log(SCHOOL_NAME + " - المساعد الذكي يعمل...");
}

startBot();
