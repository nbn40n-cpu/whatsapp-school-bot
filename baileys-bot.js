import "dotenv/config";
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import { getAIResponse } from "./ai.js";
import QR from "qrcode-terminal";
import path from "path";

const SCHOOL_NAME = "مدرسة بديع لتعليم السياقة";
const PHONE = process.env.SCHOOL_PHONE || "0568444407";
const authPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "baileys_auth")
  : "baileys_auth";

function fmtPhone(p) {
  let c = p.replace(/\D/g, "");
  if (c.startsWith("0")) c = "972" + c.slice(1);
  return c;
}

const ownerJid = fmtPhone(PHONE) + "@s.whatsapp.net";

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const sock = makeWASocket({
    auth: state,
    browser: ["Chrome", "Linux", "120"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    retryRequestDelayMs: 5000,
    maxRetries: 3,
    defaultQueryTimeoutMs: 30000,
    keepAliveIntervalMs: 15000,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\n" + "=".repeat(40));
      console.log("📱 امسح QR من واتساب:\n");
      QR.generate(qr, { small: true });
      console.log("\n" + "=".repeat(40));
    }
    if (connection === "open") {
      console.log("\n✅ " + SCHOOL_NAME + " - المساعد متصل!");
    }
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log("\n🔄 قطع الاتصال... (الكود: " + reason + ")");
      if (shouldReconnect) {
        console.log("🔄 إعادة محاولة بعد 3 ثواني...");
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
      console.log("🔇 (المالك): " + text);
      return;
    }

    console.log("📩 " + sender + ": " + text);

    try {
      const reply = await getAIResponse(text);
      await sock.sendMessage(sender, { text: reply });
      console.log("✅ " + reply.slice(0, 60) + "...");
    } catch (err) {
      console.error("❌ خطأ:", err.message);
    }
  });
}

console.log("\n🚀 " + SCHOOL_NAME + " - المساعد الذكي يعمل...");
startBot();
