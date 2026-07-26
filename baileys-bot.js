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
      console.log("✅ تم استعادة الجلسة من BAILEYS_AUTH_B64");
    } catch (e) {
      console.log("⚠️ فشل استعادة الجلسة من BAILEYS_AUTH_B64، نبدأ من الصفر");
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
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
      console.log("\n📱 تم استلام QR كود - امسحه من تلفونك");
    }

    if (connection === "open") {
      pairingDone = true;
      console.log(`\n✅ ${SCHOOL_NAME} - المساعد متصل بالواتساب!`);

      // Save backup auth string
      try {
        const b64 = serializeState(state);
        console.log(`\n📌 BAILEYS_AUTH_B64 (احفظ هذا كـ Variable):`);
        console.log(b64);
        console.log("");
      } catch (_) {}
    }

    if (connection === "close") {
      const r = lastDisconnect?.error?.output?.statusCode;
      if (r === DisconnectReason.loggedOut) {
        console.log("\n🚪 تم تسجيل الخروج. امسح المتغير BAILEYS_AUTH_B64 وأعد النشر");
        return;
      }
      if (r === DisconnectReason.badSession) {
        console.log("\n⚠️ جلسة تالفة. امسح المتغير BAILEYS_AUTH_B64 وأعد النشر");
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
        console.log("📲 واتساب > الإعدادات > الأجهزة المرتبطة > ربط جهاز\n");
        pairingDone = true;
      } catch (e) {
        if (!e.message?.includes("not available")) {
          console.log("⚠️ كود الاقتران غير متاح حالياً، جرب QR إذا ظهر");
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
