import "dotenv/config";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import { getAIResponse, transcribeAudio } from "./ai.js";
import QR from "qrcode";
import path from "path";
import fs from "fs";
import http from "http";

const SCHOOL_NAME = "مدرسة بديع لتعليم السياقة";
const PHONE = process.env.SCHOOL_PHONE || "0568444407";
const GREETING = "وعليكم السلام ورحمة الله وبركاته، أهلاً وسهلاً بك في مدرسة البديع لتعليم السياقة. أنا سوزي، مساعد المدرب سمير. تفضل، كيف أستطيع مساعدتك؟";
const FAREWELLS = ["العفو، أهلاً وسهلاً بك. إذا احتجت أي استفسار آخر نحن جاهزون لخدمتك. نتمنى لك التوفيق.", "على الرحب والسعة، نتمنى لك التوفيق، وأهلاً وسهلاً بك في مدرسة البديع لتعليم السياقة."];
const TRANSFER_PHRASES = ["للمدرب سمير", "المدرب سمير", "يتواصل معك"];
const GREETING_PATTERN = /^(السلام عليكم|وعليكم السلام|مرحبا|اهلين|هلا|صباح|مساء|مرحب|hi|hello)/i;
const THANKS_PATTERN = /^(شكرا|شكراً|تسلم|مشكور|يعطيك العافية|بارك الله فيك|الله يعطيك العافية)/i;

function fmtPhone(p) { let c = p.replace(/\D/g, ""); if (c.startsWith("0")) c = "972" + c.slice(1); return c; }
const ownerJid = fmtPhone(PHONE) + "@c.us";
const volPath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
console.log(`📂 VOLUME: ${volPath || "NOT SET"}`);
const sessionPath = volPath ? path.join(volPath, "wwjs_session") : "wwjs_session";
console.log(`📂 SESSION: ${sessionPath}`);
const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

if (process.env.FORCE_CLEAR === "true") { console.log("🧹 FORCE CLEAR"); try { fs.rmSync(sessionPath, { recursive: true, force: true }); console.log("🧹 Cleared:", sessionPath); } catch (e) { console.log("🧹 Clear error:", e.message); } }
else {
  // Remove Chromium locks/cache to force clean session reload
  for (const dir of [sessionPath, path.join(sessionPath, "session")]) {
    try { if (fs.existsSync(dir)) for (const e of fs.readdirSync(dir)) if (e.startsWith("Singleton") || e.startsWith("SINGLETON") || e === "LOCK" || e === "lockfile" || e === "chrome_debug.log" || e.endsWith(".tmp") || e.startsWith("Crashpad") || e.startsWith("Crash Reports")) fs.rmSync(path.join(dir, e), { recursive: true, force: true }); } catch (_) {}
  }
}

// Clean Chromium cache to force fresh WhatsApp Web load
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: sessionPath }),
  puppeteer: {
    executablePath: chromePath, headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-gpu","--disable-dev-shm-usage","--single-process","--no-zygote"],
  },
});

const seen = new Set();
const greeted = new Set();

function isPersonal(from) { return from && !from.endsWith("@g.us") && from !== "status@broadcast"; }
function msgKey(m) { return (m.from || "") + "_" + (m.body || "") + "_" + (m.timestamp || 0); }
function isGreeting(text) { return GREETING_PATTERN.test(text.trim()); }
function isThanks(text) { return THANKS_PATTERN.test(text.trim()); }
function isOwner(from) { return from === ownerJid; }

async function sendMsg(to, text) {
  for (let i = 0; i < 3; i++) {
    try { await client.sendMessage(to, text); return; } catch (e) { if (i < 2) await new Promise(r => setTimeout(r, 2000)); }
  }
}

async function handleMsg(msg) {
  if (msg.fromMe || !msg.from || !isPersonal(msg.from)) return;
  const isVoice = msg.type === "ptt" || msg.type === "audio";
  let body = (msg.body || "").trim();
  if (!body && !isVoice) return;

  console.log(`📩 ${msg.from}: ${isVoice ? "[صوت]" : body}`);

  if (isVoice) {
    try {
      const media = await msg.downloadMedia();
      if (media && media.data) {
        const buff = Buffer.from(media.data, "base64");
        const text = await transcribeAudio(buff, media.mimetype);
        if (text) { body = text; console.log(`🎤 ${msg.from}: ${text.slice(0,60)}`); }
        else { await sendMsg(msg.from, "عذراً، ما فهمت الرسالة الصوتية. جرب تكتب."); return; }
      } else { await sendMsg(msg.from, "عذراً، ما فهمت الرسالة الصوتية. جرب تكتب."); return; }
    } catch (e) { await sendMsg(msg.from, "عذراً، ما فهمت الرسالة الصوتية. جرب تكتب."); return; }
  }

  if (isThanks(body)) {
    const f = FAREWELLS[Math.floor(Math.random() * FAREWELLS.length)];
    await sendMsg(msg.from, f);
    console.log(`👋 ${f.slice(0,30)}`);
    return;
  }

  if (!greeted.has(msg.from)) {
    greeted.add(msg.from);
    if (isGreeting(body)) {
      await sendMsg(msg.from, GREETING);
      console.log(`✅ ترحيب`);
      return;
    }
  }

  try {
    const reply = await getAIResponse(body);
    await sendMsg(msg.from, reply);
    console.log(`✅ ${reply.slice(0,50)}`);

    if (TRANSFER_PHRASES.some(p => reply.includes(p))) {
      let name = "طالب";
      try { const c = await msg.getContact(); name = c.pushname || c.name || "طالب"; } catch (_) {}
      await sendMsg(ownerJid, `📞 تحويل من ${name} (${msg.from}): "${body}"\n---\nرد: ${reply}`);
      console.log(`📞 تم التحويل`);
    }
  } catch (err) {
    if (err.message?.includes("429")) {
      await new Promise(r => setTimeout(r, 5000));
      try { const r = await getAIResponse(body); await sendMsg(msg.from, r); } catch (_) { await sendMsg(msg.from, "عذراً، ضغط عالسيرفر. جرب بعد شوي..."); }
    } else { console.error(`❌ ${err.message}`); }
  }
}

// ---------- message events ----------
client.on("message", async (msg) => { if (msg && !msg.fromMe && msg.from && isPersonal(msg.from) && msg.body?.trim()) { const k = msg.id?._serialized || msgKey(msg); if (!seen.has(k) && !knownMsgs.has(k)) { seen.add(k); knownMsgs.add(k); console.log(`📩 ${msg.from}: ${(msg.body || "")?.slice(0,60)}`); handleMsg(msg); } } });
client.on("message_create", async (msg) => {
  if (!msg || msg.fromMe || !msg.from || !isPersonal(msg.from)) return;
  const key = msg.id?._serialized || msgKey(msg);
  if (seen.has(key) || knownMsgs.has(key)) return;
  seen.add(key);
  knownMsgs.add(key);
  console.log(`📩 ${msg.from}: ${(msg.body || "")?.slice(0,60) || "[media]"}`);
  handleMsg(msg);
});

// ---------- QR ----------
const qrPath = process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "qr_code.png") : "qr_code.png";
let latestQr = null;

client.on("qr", async (qr) => {
  console.log("\n═══════════════\nامسح QR:\nالإعدادات > الأجهزة المرتبطة > ربط جهاز\n═══════════════\n");
  try { console.log(await QR.toString(qr, { type: "terminal", small: true })); } catch (_) {}
  try { await QR.toFile(qrPath, qr, { width: 400, margin: 2 }); latestQr = qrPath; console.log(`حفظ QR: ${qrPath}\n`); } catch (_) {}
  console.log(`https://quickchart.io/qr?text=${encodeURIComponent(qr)}&size=400\n`);
});

const knownMsgs = new Set();

async function onReady() {
  const i = client.info;
  if (!i) return;
  const j = typeof i.me === 'object' ? (i.me._serialized || i.me.user + '@' + i.me.server) : i.me;
  console.log(`\n✅ ${SCHOOL_NAME} - المساعد متصل!`);
  console.log(`👤 ${j} ${i.pushname}`);

  // Poll for new messages every 8 seconds via page.evaluate (bypasses events)
  setInterval(async () => {
    try {
      // Try whatsapp-web.js API first
      const chats = await client.getChats();
      for (const chat of chats) {
        if (!chat.id?._serialized || chat.id._serialized.endsWith("@g.us") || chat.id._serialized === i.wid?._serialized) continue;
        const msgs = await chat.fetchMessages({ limit: 1 });
        for (const m of msgs) {
          const key = m.id?._serialized || msgKey(m);
          if (!knownMsgs.has(key) && !m.fromMe && m.from && isPersonal(m.from)) {
            knownMsgs.add(key);
            if (!seen.has(key) && m.body?.trim()) { seen.add(key); console.log(`📩 ${m.from}: ${m.body.slice(0,60)}`); handleMsg(m); }
          }
        }
      }
    } catch (_) {}
    // Try direct Puppeteer page access as fallback
    try {
      const pg = client.pupPage;
      if (pg && !pg.isClosed()) {
        const raw = await pg.evaluate(() => {
          const chats = document.querySelectorAll('[data-testid="chat-list"] [data-testid="cell-frame-container"]');
          const results = [];
          for (const c of chats) {
            const unread = c.querySelector('[data-testid="icon-unread-count"]');
            if (unread) {
              const title = c.querySelector('[data-testid="conversation-info-header"]')?.textContent || '';
              const msg = c.querySelector('[data-testid="last-msg"]')?.textContent || '';
              results.push({ title, msg });
            }
          }
          return results;
        });
        for (const r of raw) {
          if (r.msg) { console.log(`📩[page] ${r.title}: ${r.msg.slice(0,60)}`); }
        }
      }
    } catch (_) {}
  }, 8000);
}

// Check for client.info readiness periodically
const readyCheck = setInterval(() => { if (client.info) { clearInterval(readyCheck); onReady(); } }, 2000);

client.on("ready", () => {
  if (client.info) { clearInterval(readyCheck); onReady(); }
});

client.on("authenticated", () => {
  console.log("🔐 تم تسجيل الدخول");
});
client.on("auth_failure", (m) => console.error("❌ فشل الدخول:", m));
client.on("disconnected", (r) => { console.log(`🔄 قطع (${r})، إعادة...`); setTimeout(() => client.initialize(), 5000); });

// ---------- HTTP ----------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  if (req.url === "/qr" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${SCHOOL_NAME}</title><style>body{background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#fff;font-family:sans-serif}.qr-wrap{background:#fff;border-radius:12px;padding:16px}img{display:block;max-width:90vw;height:auto}</style></head><body><div class="qr-wrap"><img src="/qr-image"></div><h3 id="s">⏳</h3><script>fetch('/qr-status').then(r=>r.json()).then(d=>{document.getElementById('s').textContent=d.connected?'✅ متصل':d.qr?'📱 امسح QR':'⚠️'}).catch(()=>{});setInterval(()=>{fetch('/qr-status').then(r=>r.json()).then(d=>{if(d.connected)document.getElementById('s').textContent='✅ متصل'})},5000)</script></body></html>`);
  } else if (req.url === "/qr-image" && latestQr && fs.existsSync(latestQr)) {
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" }); fs.createReadStream(latestQr).pipe(res);
  } else if (req.url === "/qr-status") {
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ connected: !!client.info, qr: !!latestQr }));
  } else if (req.url === "/restart") {
    res.writeHead(200, { "Content-Type": "text/plain" }); res.end("restarting");
    setTimeout(() => process.exit(1), 500);
  } else { res.writeHead(404); res.end(); }
}).listen(PORT, () => { console.log(`🌐 ${PORT}`); if (process.env.RAILWAY_PUBLIC_DOMAIN) console.log(`🌐 https://${process.env.RAILWAY_PUBLIC_DOMAIN}`); });

process.on("uncaughtException", (e) => console.error("💥", e.message));
process.on("unhandledRejection", (e) => console.error("💥", e.message));

async function startBot(r = 5) {
  for (let i = 0; i < r; i++) {
    try {
      console.log(`\n🚀 محاولة ${i+1}/${r}`);
      await client.initialize(); return;
    } catch (e) {
      console.error(`❌ ${e.message}`);
      const cp = path.join(sessionPath, "session");
      try { if (fs.existsSync(cp)) for (const f of fs.readdirSync(cp)) if (f.startsWith("Singleton") || f === "LOCK") fs.rmSync(path.join(cp, f), { recursive: true, force: true }); } catch (_) {}
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  console.error("❌ فشل"); process.exit(1);
}
startBot();
