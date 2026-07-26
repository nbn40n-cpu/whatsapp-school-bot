import "dotenv/config";
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import { getAIResponse } from "./ai.js";
import QR from "qrcode-terminal";
import path from "path";
import fs from "fs";

const SCHOOL_NAME = "مدرسة بديع لتعليم السياقة";
const PHONE = process.env.SCHOOL_PHONE || "0568444407";

function fmtPhone(p) {
  let c = p.replace(/\D/g, "");
  if (c.startsWith("0")) c = "972" + c.slice(1);
  return c;
}

const ownerJid = fmtPhone(PHONE) + "@s.whatsapp.net";

const authPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "baileys_auth")
  : "baileys_auth";

function serializeAuth(state) {
  const data = { creds: state.creds, keys: {} };
  for (const [id, key] of state.keys.entries()) {
    data.keys[id] = key;
  }
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function startBot() {
  console.log("\n\u{1F680} " + SCHOOL_NAME + " - المساعد الذكي يعمل...");

  let savedAuth = process.env.BAILEYS_AUTH_B64;
  if (savedAuth) {
    try {
      const data = JSON.parse(Buffer.from(savedAuth, "base64").toString());
      ensureDir(authPath);
      fs.writeFileSync(path.join(authPath, "creds.json"), JSON.stringify(data.creds, null, 2));
      const appStateSync = path.join(authPath, "app-state-sync-key.json");
      if (!fs.existsSync(appStateSync)) {
        fs.writeFileSync(appStateSync, "{}");
      }
      console.log("✅ تم استعادة الجلسة من BAILEYS_AUTH_B64");
    } catch (e) {
      console.log("⚠️ فشل قراءة BAILEYS_AUTH_B64, نبدأ من الصفر");
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const sock = makeWASocket({
    auth: state,
    browser: ["Chrome", "Linux", "120"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    retryRequestDelayMs: 5000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    connectTimeoutMs: 60000,
  });

  sock.ev.on("creds.update", saveCreds);

  let qrShown = false;

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr && !qrShown) {
      qrShown = true;
      console.log("\n" + "=".repeat(40));
      console.log("\u{1F4F1} امسح QR من واتساب:\n");
      QR.generate(qr, { small: true });
      console.log("\n" + "=".repeat(40));

      // Try pairing code too
      if (process.env.SCHOOL_PHONE) {
        try {
          const code = await sock.requestPairingCode(fmtPhone(PHONE));
          console.log("\n\u{1F4CD} أو استخدم كود الاقتران: " + code);
          console.log("   واتساب > الإعدادات > الأجهزة المرتبطة > ربط جهاز\n");
        } catch (_) {}
      }
    }
    if (connection === "open") {
      console.log("\n\u2705 " + SCHOOL_NAME + " - المساعد متصل!");
      // Save auth to env var format for backup
      try {
        const b64 = serializeAuth(state);
        console.log("\n\u{1F4BE} BAILEYS_AUTH_B64 (انسخ هذا للسيرفر):");
        console.log(b64);
        console.log("\n");
      } catch (_) {}
    }
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log("\n\u{1F504} قطع الاتصال... (الكود: " + reason + ")");
      if (shouldReconnect) {
        console.log(" إعادة محاولة بعد 3 ثواني...");
        setTimeout(() => startBot(), 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;
    if (msg.key.remoteJid === "status@broadcast") return;

    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    if (!text.trim()) return;

    const sender = msg.key.remoteJid;
    if (sender === ownerJid) {
      console.log("\u{1F507} (المالك): " + text);
      return;
    }

    console.log("\u{1F4E9} " + sender + ": " + text);

    try {
      const reply = await getAIResponse(text);
      await sock.sendMessage(sender, { text: reply });
      console.log("\u2705 " + reply.slice(0, 60) + "...");
    } catch (err) {
      console.error("\u274C خطأ:", err.message);
    }
  });
}

startBot();
