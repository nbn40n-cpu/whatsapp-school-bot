import "dotenv/config";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import { getAIResponse } from "./ai.js";
import QR from "qrcode";
import path from "path";
import fs from "fs";
import http from "http";

const SCHOOL_NAME = "مدرسة بديع لتعليم السياقة";
const PHONE = process.env.SCHOOL_PHONE || "0568444407";

function fmtPhone(p) {
  let c = p.replace(/\D/g, "");
  if (c.startsWith("0")) c = "972" + c.slice(1);
  return c;
}

const ownerJid = fmtPhone(PHONE) + "@c.us";

const sessionPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "wwjs_session")
  : "wwjs_session";

const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH ||
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/usr/bin/chromium");

if (process.env.CLEAR_SESSION === "true") {
  try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (_) {}
} else {
  // Delete Chrome profile files but keep WhatsApp auth (Session/ dir)
  const chromeProfile = path.join(sessionPath, "session");
  try {
    if (fs.existsSync(chromeProfile)) {
      for (const entry of fs.readdirSync(chromeProfile)) {
        const full = path.join(chromeProfile, entry);
        if (entry.startsWith("Singleton") || entry === "LOCK") {
          fs.rmSync(full, { recursive: true, force: true });
        }
      }
    }
  } catch (_) {}
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: sessionPath }),
  puppeteer: {
    executablePath: chromePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--single-process",
      "--no-zygote",
      "--disable-features=LockProfile",
      "--disable-software-rasterizer",
      "--disable-blink-features=AutomationControlled",
    ],
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  },
});

const qrPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "qr_code.png")
  : "qr_code.png";

client.on("qr", async (qr) => {
  console.log(`\n══════════════════════════════════`);
  console.log(`امسح QR كود من واتساب تلفونك:`);
  console.log(`الإعدادات > الأجهزة المرتبطة > ربط جهاز`);
  console.log(`══════════════════════════════════\n`);

  try {
    const qrTerminal = await QR.toString(qr, { type: "terminal", small: true });
    console.log(qrTerminal);
  } catch (_) {}

  try {
    await QR.toFile(qrPath, qr, { width: 400, margin: 2 });
    latestQrPath = qrPath;
    console.log(`تم حفظ QR كصورة: ${qrPath}\n`);
  } catch (_) {}

  const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qr)}&size=400`;
  console.log(`\n🔗 رابط QR (افتحه في المتصفح):\n${qrUrl}\n`);
});

client.on("ready", () => {
  console.log(`\n✅ ${SCHOOL_NAME} - المساعد متصل بالواتساب!`);
  setInterval(() => {
    const info = client.info;
    if (info) console.log(`💓 heartbeat: connected as ${info.pushname || info.me}`);
  }, 60000);
});

client.on("authenticated", () => {
  console.log(`\n🔐 تم تسجيل الدخول بنجاح!`);
});

client.on("auth_failure", (msg) => {
  console.error(`\n❌ فشل تسجيل الدخول:`, msg);
});

client.on("disconnected", (reason) => {
  console.log(`\n🔄 قطع (${reason}). إعادة بعد 10 ثواني...`);
  setTimeout(() => client.initialize(), 10000);
});

const firstReplies = new Set();
const GREETING = "مرحباً! أهلاً بك في مدرسة بديع لتعليم السياقة. أنا سوزي مساعدة المدرب سمير، أي استفسار تفضل.";
const TRANSFER_PHRASES = ["للمدرب سمير", "المدرب سمير", "يتواصل معك"];

// watchdog: يراقب وصول الرسايل ويعيد الاتصال إذا صار في مشكلة
let lastMsgTime = Date.now();
setInterval(async () => {
  const idle = Date.now() - lastMsgTime;
  console.log(`🔍 watchdog: idle=${idle}s`);
  if (idle > 120000) {
    console.log(`⚠️ ما وصلتش رسايل من دقيقتين. بعيد الاتصال...`);
    try { await client.destroy(); } catch (_) {}
    setTimeout(() => client.initialize(), 5000);
  }
}, 30000);

client.on("message_create", (msg) => { lastMsgTime = Date.now(); handleMsg(msg); });

async function handleMsg(msg) {
  if (msg.fromMe) return;
  if (msg.isGroup || msg.from.endsWith("@g.us")) return;
  if (msg.from === "status@broadcast") return;
  if (!msg.body || msg.body.trim() === "") return;

  if (msg.from === ownerJid) {
    console.log(`🔇 (المالك): ${msg.body}`);
    return;
  }

  console.log(`📩 ${msg.from}: ${msg.body}`);

  // أول رسالة من الطالب → ترحيب مباشر بدون AI
  if (!firstReplies.has(msg.from)) {
    firstReplies.add(msg.from);
    await msg.reply(GREETING);
    console.log(`✅ ترحيب: ${GREETING.slice(0, 50)}...`);
    return;
  }

  try {
    const reply = await getAIResponse(msg.body);
    await msg.reply(reply);
    console.log(`✅ ${reply.slice(0, 60)}...`);

    // إذا الذكاء ما عرف يجاوب → يحول للمالك
    if (TRANSFER_PHRASES.some(p => reply.includes(p))) {
      const contact = await msg.getContact();
      const name = contact.pushname || contact.name || "طالب";
      const forwardMsg = `📞 تحويل من ${name} (${msg.from}):\n"${msg.body}"\n---\nرد البوت: ${reply}`;
      await client.sendMessage(ownerJid, forwardMsg);
      console.log(`📞 تم تحويل المحادثة للمالك`);
    }
  } catch (err) {
    if (err.message && err.message.includes("429")) {
      console.error("⚠️ Rate limit, waiting 5s...");
      await new Promise(r => setTimeout(r, 5000));
      try {
        const reply = await getAIResponse(msg.body);
        await msg.reply(reply);
        console.log(`✅ ${reply.slice(0, 60)}...`);
      } catch (_) {
        await msg.reply("عذراً، صار ضغط عالسيرفر. جرب بعد شوي...");
      }
    } else {
      console.error("❌ خطأ:", err.message);
    }
  }
}

const PORT = process.env.PORT || 3000;
let latestQrPath = null;

http.createServer((req, res) => {
  if (req.url === "/qr" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QR Code - ${SCHOOL_NAME}</title>
<style>body{background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#fff;font-family:sans-serif}
.qr-wrap{background:#fff;border-radius:12px;padding:16px}
img{display:block;max-width:90vw;height:auto;image-rendering:pixelated}
h3{text-align:center;margin-top:20px;color:#0f0}
h4{text-align:center;color:#ff0;margin:5px 0}
p{color:#aaa;font-size:14px;text-align:center}
</style>
</head><body>
<div class="qr-wrap"><img src="/qr-image" alt="QR Code"></div>
<h3 id="status">⏳ انتظر...</h3>
<p>${SCHOOL_NAME} - المساعد الذكي</p>
<script>
const img=document.querySelector('img');
fetch('/qr-status').then(r=>r.json()).then(d=>{
  if(d.connected){document.getElementById('status').textContent='✅ متصل!';document.getElementById('status').style.color='#0f0'}
  else if(d.qr){document.getElementById('status').textContent='📱 امسح QR';img.src='/qr-image?'+Date.now();setTimeout(()=>img.src='/qr-image?'+Date.now(),5000)}
  else{document.getElementById('status').textContent='⚠️ لا يوجد QR بعد...'}
});
setInterval(()=>{img.src='/qr-image?'+Date.now()},5000);
setInterval(()=>{fetch('/qr-status').then(r=>r.json()).then(d=>{
  if(d.connected)document.getElementById('status').textContent='✅ متصل!'
})},5000);
</script>
</body></html>`);
  } else if (req.url === "/qr-image") {
    if (latestQrPath && fs.existsSync(latestQrPath)) {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
      fs.createReadStream(latestQrPath).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("No QR yet");
    }
  } else if (req.url === "/qr-status") {
    const connected = client.info ? true : false;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ connected, qr: !!latestQrPath }));
  } else {
    res.writeHead(404); res.end();
  }
}).listen(PORT, () => {
  console.log(`🌐 Web UI: http://localhost:${PORT}`);
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    console.log(`🌐 Public: https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
  }
});

process.on("uncaughtException", (err) => {
  console.error("💥 uncaughtException:", err.message);
});
process.on("unhandledRejection", (err) => {
  console.error("💥 unhandledRejection:", err.message);
});

async function startBot(retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`\n🚀 ${SCHOOL_NAME} - المساعد الذكي يعمل... (محاولة ${i + 1}/${retries})`);
      await client.initialize();
      return;
    } catch (err) {
      console.error(`❌ محاولة ${i + 1} فشلت:`, err.message);
      // نضف الـ Chrome profile بالكامل
      const chromeProfile = path.join(sessionPath, "session");
      try { fs.rmSync(chromeProfile, { recursive: true, force: true }); } catch (_) {}
      const wait = 5 * (i + 1);
      console.log(`⏳ ننتظر ${wait} ثواني ونعيد المحاولة...`);
      await new Promise(r => setTimeout(r, wait * 1000));
    }
  }
  console.error(`❌ فشل تشغيل البوت بعد ${retries} محاولات`);
  process.exit(1);
}

startBot();
