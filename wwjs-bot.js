import "dotenv/config";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import { getAIResponse } from "./ai.js";
import QR from "qrcode";
import path from "path";

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

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: sessionPath }),
  puppeteer: {
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  },
});

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
    await QR.toFile("qr_code.png", qr, { width: 400, margin: 2 });
    console.log(`تم حفظ QR كصورة: qr_code.png\n`);
  } catch (_) {}
});

client.on("ready", () => {
  console.log(`\n✅ ${SCHOOL_NAME} - المساعد متصل بالواتساب!`);
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

client.on("message", async (msg) => {
  if (msg.fromMe) return;
  if (msg.isGroup) return;
  if (msg.from === "status@broadcast") return;
  if (msg.from.endsWith("@lid")) return;
  if (!msg.body || msg.body.trim() === "") return;

  if (msg.from === ownerJid) {
    console.log(`🔇 (المالك): ${msg.body}`);
    return;
  }

  console.log(`📩 ${msg.from}: ${msg.body}`);

  try {
    const reply = await getAIResponse(msg.body);
    await msg.reply(reply);
    console.log(`✅ ${reply.slice(0, 60)}...`);
  } catch (err) {
    console.error("❌ خطأ:", err.message);
  }
});

console.log(`\n🚀 ${SCHOOL_NAME} - المساعد الذكي يعمل...`);
client.initialize();
