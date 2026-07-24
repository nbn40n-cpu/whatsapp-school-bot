import "dotenv/config";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { getAIResponse } from "./ai.js";
import QR from "qrcode";

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

let sock = null;

async function startBot() {
  if (sock) {
    sock.removeAllListeners();
    sock.end(undefined);
    sock = null;
    await new Promise((r) => setTimeout(r, 2000));
  }

  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    browser: ["Chrome", "122.0.0.0", ""],
  });

  sock.ev.on("creds.update", saveCreds);

  let pairingDone = false;

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr && !pairingDone && !state.creds?.registered) {
      console.log("\n📱 تم استلام QR كود ...");
      try {
        await QR.toFile("qr_code.png", qr, { width: 400, margin: 2 });
        console.log("✅ تم حفظ QR كود في: qr_code.png");
        console.log("📂 افتح الملف وامسحه من واتساب تلفونك");
      } catch (e) {
        console.log("⚠️", e.message);
      }
    }

    if (connection === "open") {
      pairingDone = true;
      console.log(`\n✅ ${SCHOOL_NAME} - المساعد متصل بالواتساب!`);
    }

    if (connection === "close") {
      const r = lastDisconnect?.error?.output?.statusCode;
      if (r === DisconnectReason.loggedOut) {
        console.log("\n🚪 تم تسجيل الخروج. احذف مجلد auth_info واركض npm start");
        return;
      }
      if (r === DisconnectReason.badSession) {
        console.log("\n⚠️ جلسة تالفة. احذف auth_info واركض npm start");
        return;
      }
      console.log(`\n🔄 قطع (${r || "?"}). إعادة بعد 10 ثواني...`);
      sock = null;
      setTimeout(startBot, 10000);
    }
  });

  if (!state.creds?.registered) {
    setTimeout(async () => {
      try {
        const num = fmtPhone(PHONE);
        const code = await sock.requestPairingCode(num);
        const display = code.match(/.{1,4}/g)?.join("-") || code;
        console.log(`\n🔐 كود الاقتران: ${display}`);
        console.log(`📲 واتساب > الأجهزة المرتبطة > ربط جهاز > الاقتران برقم الهاتف\n`);
        pairingDone = true;
      } catch (e) {
        if (!e.message?.includes("not available")) {
          console.log("⚠️ كود الاقتران غير متاح، استخدم QR");
        }
      }
    }, 4000);
  } else {
    console.log(`\n🔐 جلسة محفوظة. تسجيل الدخول...`);
  }

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.fromMe || isGroup(msg.key.remoteJid)) continue;
      const text = getText(msg);
      if (!text) continue;

      const sender = msg.key.remoteJid;
      if (sender === `${fmtPhone(PHONE)}@s.whatsapp.net`) {
        console.log(`🔇 (المالك): ${text}`);
        continue;
      }

      console.log(`📩 ${sender}: ${text}`);

      try {
        await sock.sendPresenceUpdate("composing", sender);
        const reply = await getAIResponse(text);
        await sock.sendPresenceUpdate("paused", sender);
        await sock.sendMessage(sender, { text: reply });
        console.log(`✅ ${reply.slice(0, 60)}...`);
      } catch (err) {
        console.error("❌ خطأ:", err.message);
      }
    }
  });

  console.log(`\n🚀 ${SCHOOL_NAME} - المساعد الذكي يعمل...`);
}

startBot();
