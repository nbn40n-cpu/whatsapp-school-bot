import "dotenv/config";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QR from "qrcode";
import path from "path";
import fs from "fs";
import http from "http";
import { getAIResponse, transcribeAudio } from "./ai.js";
import pino from "pino";

const SCHOOL_NAME = "مدرسة بديع لتعليم السياقة";
const PHONE = process.env.SCHOOL_PHONE || "0568444407";
const GREETING = "وعليكم السلام ورحمة الله وبركاته، أهلاً وسهلاً بك في مدرسة البديع لتعليم السياقة. أنا سوزي، مساعد المدرب سمير. تفضل، كيف أستطيع مساعدتك؟";
const FAREWELLS = ["العفو، أهلاً وسهلاً بك. إذا احتجت أي استفسار آخر نحن جاهزون لخدمتك. نتمنى لك التوفيق.", "على الرحب والسعة، نتمنى لك التوفيق، وأهلاً وسهلاً بك في مدرسة البديع لتعليم السياقة."];
const TRANSFER_PHRASES = ["للمدرب سمير", "المدرب سمير", "يتواصل معك"];
const GREETING_PATTERN = /^(السلام عليكم|وعليكم السلام|مرحبا|اهلين|هلا|صباح|مساء|مرحب|hi|hello)/i;
const THANKS_PATTERN = /^(شكرا|شكراً|تسلم|مشكور|يعطيك العافية|بارك الله فيك|الله يعطيك العافية)/i;

function fmtPhone(p) { let c = p.replace(/\D/g, ""); if (c.startsWith("0")) c = "972" + c.slice(1); return c; }
const ownerJid = fmtPhone(PHONE) + "@s.whatsapp.net";

const authPath = process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "baileys_auth") : "./baileys_auth";
if (process.env.FORCE_CLEAR === "true") { try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (_) {} }

const seen = new Set();
const greeted = new Set();

function isPersonal(jid) { return jid && !jid.endsWith("@g.us") && jid !== "status@broadcast"; }
function msgKey(m) { return (m.key?.remoteJid || "") + "_" + (m.message?.conversation || m.message?.extendedTextMessage?.text || "") + "_" + (m.messageTimestamp || 0); }
function isGreeting(text) { return GREETING_PATTERN.test(text.trim()); }
function isThanks(text) { return THANKS_PATTERN.test(text.trim()); }
function isOwner(jid) { return jid === ownerJid; }

function bodyFromMsg(msg) {
  if (msg.message?.conversation) return msg.message.conversation;
  if (msg.message?.extendedTextMessage?.text) return msg.message.extendedTextMessage.text;
  if (msg.message?.imageMessage?.caption) return msg.message.imageMessage.caption;
  return "";
}

let sock = null;
const QR_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "qr_code.png") : "qr_code.png";
let latestQr = null;

async function sendMsg(to, text) {
  for (let i = 0; i < 3; i++) {
    try { await sock.sendMessage(to, { text }); return; } catch (e) { if (i < 2) await new Promise(r => setTimeout(r, 2000)); }
  }
}

async function handleMsg(msg) {
  if (!msg.key || msg.key.fromMe || !isPersonal(msg.key.remoteJid) || isOwner(msg.key.remoteJid)) return;
  const from = msg.key.remoteJid;
  const isVoice = !!msg.message?.audioMessage;
  let body = bodyFromMsg(msg);
  if (!body && !isVoice) return;
  if (isVoice && msg.message?.audioMessage?.seconds > 120) return;

  console.log(`📩 ${from}: ${isVoice ? "[صوت]" : body}`);

  if (isVoice) {
    try {
      const stream = await downloadContentFromMessage(msg.message.audioMessage, "audio");
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buff = Buffer.concat(chunks);
      const text = await transcribeAudio(buff, "audio/ogg; codecs=opus");
      if (text) { body = text; console.log(`🎤 ${from}: ${text.slice(0,60)}`); }
      else { await sendMsg(from, "عذراً، ما فهمت الرسالة الصوتية. جرب تكتب."); return; }
    } catch (e) { await sendMsg(from, "عذراً، ما فهمت الرسالة الصوتية. جرب تكتب."); return; }
  }

  if (isThanks(body)) {
    const f = FAREWELLS[Math.floor(Math.random() * FAREWELLS.length)];
    await sendMsg(from, f);
    console.log(`👋 ${f.slice(0,30)}`);
    return;
  }

  if (!greeted.has(from)) {
    greeted.add(from);
    if (isGreeting(body)) {
      await sendMsg(from, GREETING);
      console.log(`✅ ترحيب`);
      return;
    }
  }

  try {
    const reply = await getAIResponse(body);
    await sendMsg(from, reply);
    console.log(`✅ ${reply.slice(0,50)}`);

    if (TRANSFER_PHRASES.some(p => reply.includes(p))) {
      const name = msg.pushName || "طالب";
      await sendMsg(ownerJid, `📞 تحويل من ${name} (${from}): "${body}"\n---\nرد: ${reply}`);
      console.log(`📞 تم التحويل`);
    }
  } catch (err) {
    if (err.message?.includes("429")) {
      await new Promise(r => setTimeout(r, 5000));
      try { const r = await getAIResponse(body); await sendMsg(from, r); } catch (_) { await sendMsg(from, "عذراً، ضغط عالسيرفر. جرب بعد شوي..."); }
    } else { console.error(`❌ ${err.message}`); }
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "error" }),
    syncFullHistory: false,
    emitOwnEvents: false,
    markOnlineOnConnect: false,
    version: [2, 3000, 1015949824],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\n═══════════════\nامسح QR:\nالإعدادات > الأجهزة المرتبطة > ربط جهاز\n═══════════════\n");
      try { console.log(await QR.toString(qr, { type: "terminal", small: true })); } catch (_) {}
      try { await QR.toFile(QR_PATH, qr, { width: 400, margin: 2 }); latestQr = true; console.log(`حفظ QR: ${QR_PATH}\n`); } catch (_) {}
      const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qr)}&size=400`;
      console.log(`${qrUrl}\n`);
    }
    if (connection === "open") {
      console.log(`\n✅ ${SCHOOL_NAME} - متصل!`);
      console.log(`👤 ${sock.user?.id || ""}`);
    }
    if (connection === "close") {
      const statusCode = lastDisconnect?.error ? new Boom(lastDisconnect.error).output.statusCode : 0;
      const errMsg = lastDisconnect?.error?.message || "";
      if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || errMsg.includes("logged")) {
        console.error("❌ تسجيل الخروج. إعادة التشغيل...");
        try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (_) {}
        process.exit(1);
      } else {
        console.log(`🔄 قطع (${statusCode}: ${errMsg.slice(0,60)}). انتظار الاتصال التلقائي...`);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (msg.key?.fromMe || !isPersonal(msg.key?.remoteJid) || isOwner(msg.key?.remoteJid)) continue;
      const key = msgKey(msg);
      if (seen.has(key)) continue;
      seen.add(key);
      handleMsg(msg);
    }
  });
}

// HTTP server
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  if (req.url === "/qr" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${SCHOOL_NAME}</title><style>body{background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#fff;font-family:sans-serif}.qr-wrap{background:#fff;border-radius:12px;padding:16px}img{display:block;max-width:90vw;height:auto}</style></head><body><div class="qr-wrap"><img src="/qr-image"></div><h3 id="s">⏳</h3><script>fetch('/qr-status').then(r=>r.json()).then(d=>{document.getElementById('s').textContent=d.connected?'✅ متصل':d.qr?'📱 امسح QR':'⚠️'}).catch(()=>{});setInterval(()=>{fetch('/qr-status').then(r=>r.json()).then(d=>{if(d.connected)document.getElementById('s').textContent='✅ متصل'})},5000)</script></body></html>`);
  } else if (req.url === "/qr-image") {
    if (fs.existsSync(QR_PATH)) {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" }); fs.createReadStream(QR_PATH).pipe(res);
    } else { res.writeHead(404); res.end("no qr"); }
  } else if (req.url === "/qr-status") {
    const connected = sock?.user ? true : false;
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ connected, qr: !!latestQr }));
  } else if (req.url === "/restart") {
    res.writeHead(200, { "Content-Type": "text/plain" }); res.end("restarting");
    setTimeout(() => process.exit(1), 500);
  } else { res.writeHead(404); res.end(); }
}).listen(PORT, () => { console.log(`🌐 ${PORT}`); if (process.env.RAILWAY_PUBLIC_DOMAIN) console.log(`🌐 https://${process.env.RAILWAY_PUBLIC_DOMAIN}`); });

process.on("uncaughtException", (e) => console.error("💥", e.message));
process.on("unhandledRejection", (e) => console.error("💥", e.message));

startBot();
