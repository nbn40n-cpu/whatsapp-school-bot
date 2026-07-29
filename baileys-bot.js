import "dotenv/config";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import { getAIResponse } from "./ai.js";
import path from "path";
import fs from "fs";

const SCHOOL_NAME = "مدرسة بديع لتعليم السياقة";
const PHONE = process.env.SCHOOL_PHONE || "0568444407";
const GREETING = "وعليكم السلام ورحمة الله وبركاته، أهلاً وسهلاً بك في مدرسة البديع لتعليم السياقة. أنا سوزي، مساعد المدرب سمير. تفضل، كيف أستطيع مساعدتك؟";
const FAREWELLS = ["العفو، أهلاً وسهلاً بك. إذا احتجت أي استفسار آخر نحن جاهزون لخدمتك.", "على الرحب والسعة، نتمنى لك التوفيق."];
const TRANSFER_PHRASES = ["للمدرب سمير", "المدرب سمير", "يتواصل معك"];
const GREETING_PATTERN = /^(السلام عليكم|وعليكم السلام|مرحبا|اهلين|هلا|صباح|مساء|مرحب|hi|hello)/i;
const THANKS_PATTERN = /^(شكرا|شكراً|تسلم|مشكور|يعطيك العافية|بارك الله فيك|الله يعطيك العافية)/i;

function fmtPhone(p) { let c = p.replace(/\D/g, ""); if (c.startsWith("0")) c = "972" + c.slice(1); return c; }
const ownerJid = fmtPhone(PHONE) + "@s.whatsapp.net";
const greeted = new Set();
const seen = new Set();
const authPath = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || ".", "baileys_auth");

function isPersonal(from) { return from && !from.endsWith("@g.us") && from !== "status@broadcast"; }
function isGreeting(text) { return GREETING_PATTERN.test(text.trim()); }
function isThanks(text) { return THANKS_PATTERN.test(text.trim()); }
function isOwner(from) { return from === ownerJid; }
function extractText(msg) {
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
  if (msg.imageMessage?.caption) return msg.imageMessage.caption;
  if (msg.videoMessage?.caption) return msg.videoMessage.caption;
  return "";
}

async function sendMsg(sock, to, text) {
  for (let i = 0; i < 3; i++) {
    try { await sock.sendMessage(to, { text }); return; } catch (e) { if (i < 2) await new Promise(r => setTimeout(r, 2000)); }
  }
}

async function handleMsg(sock, msg, jid) {
  const text = extractText(msg);
  if (!text) return;
  const key = jid + "_" + text + "_" + (msg.messageTimestamp || 0);
  if (seen.has(key)) return;
  seen.add(key);

  if (isGreeting(text) && !greeted.has(jid)) {
    greeted.add(jid);
    await sendMsg(sock, jid, GREETING);
    return;
  }
  if (isThanks(text)) {
    await sendMsg(sock, jid, FAREWELLS[Math.floor(Math.random() * FAREWELLS.length)]);
    return;
  }
  if (TRANSFER_PHRASES.some(p => text.includes(p))) {
    await sendMsg(sock, jid, "تفضل، سيتم تحويلك للمدرب سمير.");
    await sendMsg(sock, ownerJid, `الرجاء التواصل مع ${jid.split("@")[0]}`);
    return;
  }

  const reply = await getAIResponse(text);
  await sendMsg(sock, jid, reply);
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  let pairingCodeRequested = false;

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    browser: ["Termux", "", ""],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr && !state.creds.registered && !pairingCodeRequested) {
      pairingCodeRequested = true;
      const phoneNumber = fmtPhone(PHONE);
      process.stdout.write(`\n⏳ انتظر 3 ثواني لطلب كود الاقتران...\r`);
      // Delay to ensure socket is ready
      await new Promise(r => setTimeout(r, 3000));
      process.stdout.write(`\n⏳ طلب كود الاقتران للرقم ${phoneNumber}...\r`);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          let code = await sock.requestPairingCode(phoneNumber);
          if (code) {
            code = code.match(/.{1,4}/g)?.join("-") || code;
            console.log("\n" + "═".repeat(42));
            console.log("  🔑 كود الاقتران الخاص بك:");
            console.log(`\n       ${code}\n`);
            console.log("  📋 الخطوات:");
            console.log(`  1. افتح واتساب ← الإعدادات ← الأجهزة المرتبطة`);
            console.log(`  2. اضغط "ربط جهاز"`);
            console.log(`  3. اضغط ⋮ (النقاط الثلاث) ← "الربط برقم الهاتف"`);
            console.log(`  4. أدخل الكود: ${code}`);
            console.log("═".repeat(42) + "\n");
            break;
          }
        } catch (e) {
          console.error(`\n❌ محاولة ${attempt + 1}: ${e.message}`);
          if (attempt < 2) {
            console.log("   إعادة المحاولة بعد 5 ثواني...");
            await new Promise(r => setTimeout(r, 5000));
          } else {
            console.log("\n💡 حلول:");
            console.log("   1. تأكد من أن الرقم 972568444407 مسجل في واتساب");
            console.log("   2. جرب تشغيل البوت مرة أخرى");
            console.log("   3. إذا استمرت المشكلة، احذف مجلد baileys_auth وأعد التشغيل");
            pairingCodeRequested = false;
          }
        }
      }
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log(`\n🔄 قطع (${reason})، إعادة ${shouldReconnect ? "خلال 5 ثواني" : "توقف"}`);
      if (shouldReconnect) setTimeout(start, 5000);
      else { console.log("❌ تم تسجيل الخروج"); process.exit(1); }
    }

    if (connection === "open") {
      pairingCodeRequested = false;
      console.log(`\n✅ ${SCHOOL_NAME} - المساعد متصل!`);
      console.log(`👤 ${sock.user?.id || ""}`);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      const jid = m.key?.remoteJid;
      if (!jid || m.key?.fromMe || !isPersonal(jid)) continue;
      console.log(`📩 ${jid}: ${extractText(m).slice(0, 60) || "[media]"}`);
      await handleMsg(sock, m, jid);
    }
  });
}

start();

process.on("uncaughtException", (e) => console.error("💥", e.message));
process.on("unhandledRejection", (e) => console.error("💥", e.message));
