import "dotenv/config";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, downloadMediaMessage } from "@whiskeysockets/baileys";
import { getAIResponse, transcribeAudio, textToSpeech, ERROR_REPLY } from "./ai.js";
import path from "path";
import fs from "fs";
import http from "http";
import QR from "qrcode";

const SCHOOL_NAME = "مدرسة بديع لتعليم السياقة";
const PHONE = process.env.SCHOOL_PHONE || "0568444407";
const FAMILY_NUMBERS = ["0568828240", "0569268867", "0568828238"];
const FAMILY_NAMES = { "0568828240": "نهال أم محمد", "0569268867": "هدى أم آدم", "0568828238": "سميرة أم منذر" };
const INTIMATE_NUMBERS = ["0598742654"];
const BOSS_NUMBERS = ["0568444405"];
const TRAINER_NUMBERS = ["0562400502", "0568030693", "0568331002", "0562400404"];
const TRAINER_NAMES = { "0562400502": "رائد أبو صبحة", "0568030693": "عمار أبو قبيطة", "0568331002": "بديع الصغير", "0562400404": "منال" };
const TRAINER_OWNER_REPLY = "رح أتواصل مع الاستاذ سمير ويرجعلك بأقصى سرعة.";
const TRAINER_GREETING_VARIANTS = [
  "أهلاً وسهلاً بالاستاذ {name}، نورتنا، الحمد لله، كيفك شو أخبارك؟ أنا المساعدة للمدير سمير، بشو بقدر أساعدك؟",
  "أهلاً وسهلاً عمي {name}، نورتنا، كيفك شو أخبارك، كيف الصحة الله يقويك؟ أنا المساعدة للمدير سمير، بشو بقدر أساعدك؟",
  "أهلاً وسهلاً بالاستاذ {name}، الحمد لله على سلامتك، كيفك شو أخبارك؟ أنا المساعدة للمدير سمير، بشو بقدر أساعدك؟"
];
const TRAINER_FAREWELLS = ["الله يعطيك الصحة، مع الف سلامة، كل الاحترام لك.", "مع ألف سلامة، الله يقويك، نورتنا، بنستناك في أي وقت."];
const BOSS_OWNER_REPLY = "الاستاذ سمير مشغول ربما بالتدريب أو بأعمال أخرى، رح يرجعلك بأقصى سرعة.";
const BOSS_GREETING_VARIANTS = [
  "أهلاً وسهلاً أبو حسين منور، مسا الخير مسا النور، كيفك شو أخبارك، كيف صحتك، ربنا يقويك. أنا المساعدة للاستاذ سمير، شو بقدر أساعدك تفضل أبو حسين؟",
  "حياك الله منور أبو حسين، مرحبا هلا مرحبتين، كيف صحتك ربنا يعطيك الصحة، ربنا يطول بعمرك. أنا المساعدة للاستاذ سمير، شو بقدر أساعدك تفضل أبو حسين؟",
  "صباح النور منور أبو حسين، أهلاً وسهلاً، كيفك شو أخبارك، ربنا يقويك. أنا المساعدة للاستاذ سمير، شو بقدر أساعدك تفضل أبو حسين؟"
];
const BOSS_FAREWELLS = ["مع الف سلامة حج، الله يسعدك، كل الاحترام لك.", "مع ألف سلامة أبو حسين، الله يسعدك ويحفظك، نورتنا."];
const GREETING = "أهلاً وسهلاً فيك في مدرسة البديع لتعليم السياقة، تفضل، بشو بقدر أخدمك؟";
const FAMILY_GREETING = "هلا نورتينا 🌷";
const INTIMATE_GREETING = "هلا والله انتيمة، نورتي، شو أخبارك اليوم؟";
const INTIMATE_OWNER_REPLY = "إذا في أمر ضروري اتصلي مباشرة بحبيبك، وإذا مش ضروري بس يشوف الرسالة رح يرجعلك لأنه مضغوط معه درس عملي.";
const INTIMATE_FAREWELLS = ["مع السلامة، يومك سعيد، انبسطت بالحديث معك يا صديقتي، ديري بالك على حالك.", "مع ألف سلامة حبيبتي، إلهي يومك سعيد، كل ما بدك إياه إحنا موجودين، ديري بالك."];
const FAMILY_FAREWELLS = ["مع السلامة حبيبتي، الله يسعدك 🌷", "مع السلامة نورتينا، ديري بالك على حالك."];
const FAREWELLS = ["العفو، أهلين وسهلين فيك. إذا احتجت أي استفسار ثاني إحنا موجودين.", "على الرحب والسعة، بالتوفيق لك."];
const GOODBYES = ["مع السلامة، بالتوفيق لك. بننتظرك في أي وقت.", "في أمان الله، بالتوفيق، أهلين وسهلين فيك في أي وقت."];
const OWNER_WHERE_PATTERN = /(وين سمير|اين سمير|وين الاستاذ|سمير مشغول|وين المدير|توفر سمير|بدي احكي مع سمير|وين المدرب|وين شمير|بدي احكي مع شمير)/i;
const FAMILY_CALL_PATTERN = /(رني|رنيني|رنلي|اتصلي|كلمي|بدي سمير|بدنا سمير|عاوز سمير|عايز سمير|اريد سمير|أريد سمير|نادي سمير|قولي سمير|خلي سمير|خلي الاستاذ|سمير يحكي|يحكي معي سمير|يتحدث معي|بدها تحكي مع سمير|بدها تتحدث مع سمير|بدها ياك|بدها يرجعها|محتاجة سمير|بسرعة سمير|سمير بسرعة|ضروري سمير|سمير ضروري|بدي شمير|خلي شمير|شمير يحكي)/i;
const NUMBER_PATTERN = /(رقم|نمرة|تلفون|هاتف|بعطني|يعطيني|بدي رقم)[^\n]{0,15}(المدرب|المديرة|المدير|سمير|سميرة|بديع|ابو حسين)/i;
const TRANSFER_PATTERN = /(بدي|اريد|ابغى|ابغي|ابغا|عايز|عاوز|احتاج|أحتاج|ارغب|كلمني|اكلم|احكي|احكيني|اتكلم|اتحدث|اتواصل|تواصل|نقلي|حولي|حولني|مرري|ربطني|اتصل|اسال|اسأل|بسأل)[^\n]{0,25}(المدرب|المديرة|المدير|سمير|سميرة|شمير|بديع|ابو حسين)/i;
const CONFUSED_PATTERN = /(ما فهمت|ما فهمتك|مش فاهم|مش فاهمة|مش واضح|ما وضحت|راجع علي|ما بفهم|مش بفهم|بدي احد يديني|بدي احكي مع انسان)/i;
const SAMIR_CALL_PATTERN = new RegExp([
  "(بدي|بيدي|بودي|بده|بده|بدها|بدنا)[^\\s]{0,3} ((الاستاذ |المدير|المدرب )?س[مم]ير|شمير)",
  "(عاوز|عايز|اريد|ابغى|ابغي|ارغب)[^\\s]{0,3} ((الاستاذ )?س[مم]ير|شمير)",
  "(وين|وينو|اين|فين)[^\\s]{0,3} ((الاستاذ )?س[مم]ير|شمير|المدير|المدرب|الاستاذ)",
  "(احكي|احكيني|كلم|كلمني|اتصل|نادي|قولي|خلي)[^\\s]{0,3} (مع|ل|ب)? ?(الاستاذ )?((س[مم]ير)|(شمير))",
  "خلي (الاستاذ )?سمير يحكي",
  "سمير يحكي معي",
  "(الاستاذ )?سمير يحكي معي",
  "بدي احكي مع (الاستاذ )?(س[مم]ير|شمير)",
  "بدي احكي مع الاستاذ",
  "بدي اتكلم مع (الاستاذ )?(س[مم]ير|شمير)"
].join("|"), "i");
const GREETING_PATTERN = /^(السلام عليكم|وعليكم السلام|مرحبا|اهلين|هلا|صباح|مساء|مرحب|hi|hello)/i;
const THANKS_PATTERN = /^(شكرا|شكراً|تسلم|مشكور|يعطيك العافية|بارك الله فيك|الله يعطيك العافية|عاش|يعطيكي العافية)/i;
const GOODBYE_PATTERN = /^(مع السلامة|مع السلامه|باي|وداعا|بالتوفيق|معو|عم السلامه|الله معك)/i;

function fmtPhone(p) { let c = p.replace(/\D/g, ""); if (c.startsWith("0")) c = "972" + c.slice(1); return c; }
function normAr(s) {
  return (s || "")
    .replace(/[\u064B-\u0652\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0600-\u06FF\s]/g, "");
}
const ownerJid = fmtPhone(PHONE) + "@s.whatsapp.net";
const STUDENT_NAMES = {};
const greeted = new Set();
const seen = new Set();
const mediaNotified = new Set();
const ownerActive = new Map();
const OWNER_PAUSE_MS = 10 * 60 * 1000;
const mySentIds = new Set();
const lastErrorReply = new Map();
const lidToPn = new Map();
const ERROR_REPLY_COOLDOWN = 30 * 60 * 1000;
const authPath = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || ".", "baileys_auth");

let status = { state: "starting", code: null, user: null };
http
  .createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(status));
  })
  .listen(process.env.PORT || 3000, () => console.log("🌐 status on port " + (process.env.PORT || 3000)));

function isPersonal(from) { return from && !from.endsWith("@g.us") && from !== "status@broadcast"; }
function isGreeting(text) { return GREETING_PATTERN.test(text.trim()); }
function isThanks(text) { return THANKS_PATTERN.test(text.trim()); }
function isGoodbye(text) { return GOODBYE_PATTERN.test(text.trim()); }
function isOwner(from) { return from === ownerJid; }
function pnOf(from, msg) {
  if (!from) return "";
  const alt = (msg?.key?.remoteJidAlt || msg?.key?.participantAlt || "").split("@")[0];
  if (alt && alt !== from.split("@")[0]) { lidToPn.set(from, alt); }
  if (lidToPn.has(from)) return lidToPn.get(from);
  return from.split("@")[0];
}
function localDigits(pn) {
  const c = (pn || "").replace(/\D/g, "");
  if (c.startsWith("972") || c.startsWith("970")) return "0" + c.slice(3);
  return c;
}
function matchesPn(pn, num) {
  const b = (num || "").replace(/\D/g, "");
  return !!pn && localDigits(pn) === localDigits(b);
}
function isFamily(from, msg) { const pn = pnOf(from, msg); return FAMILY_NUMBERS.some(n => matchesPn(pn, n)); }
function isIntimate(from, msg) { const pn = pnOf(from, msg); return INTIMATE_NUMBERS.some(n => matchesPn(pn, n)); }
function isBoss(from, msg) { const pn = pnOf(from, msg); return BOSS_NUMBERS.some(n => matchesPn(pn, n)); }
function isTrainer(from, msg) { const pn = pnOf(from, msg); return TRAINER_NUMBERS.some(n => matchesPn(pn, n)); }
function trainerName(from, msg) { const pn = pnOf(from, msg); const n = TRAINER_NUMBERS.find(n => matchesPn(pn, n)); return TRAINER_NAMES[n] || ""; }
function familyName(from, msg) { const pn = pnOf(from, msg); const n = FAMILY_NUMBERS.find(n => matchesPn(pn, n)); return FAMILY_NAMES[n] || ""; }
function studentName(from, msg) { const pn = pnOf(from, msg); const num = Object.keys(STUDENT_NAMES).find(n => matchesPn(pn, n)); return num ? STUDENT_NAMES[num] : ""; }
function callerName(from, msg) { return familyName(from, msg) || studentName(from, msg) || (isTraining(from) ? trainerName(from, msg) : "") || (isIntimate(from, msg) ? "الانتيمة" : ""); }
function isTraining(from, msg) { return isTrainer(from, msg) || isBoss(from, msg); }
function timeGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "صباح الخير";
  if (h >= 12 && h < 18) return "مسا الخير";
  if (h >= 18) return "مسا الخير";
  return "هلا";
}
function extractText(msg) {
  const content = msg && msg.message ? msg.message : msg;
  if (!content) return "";
  if (content.conversation) return content.conversation;
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
  if (content.imageMessage?.caption) return content.imageMessage.caption;
  if (content.videoMessage?.caption) return content.videoMessage.caption;
  return "";
}
function isEmojiOnly(s) {
  const cleaned = (s || "").replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3\u2600-\u27BF\u2B00-\u2BFF\u00A9\u00AE\u2122\u2190-\u21FF\u2300-\u23FF\u25A0-\u25FF\u2900-\u297F\u2B00-\u2BFF]/gu, "").replace(/[\s\W_]/g, "");
  return !cleaned;
}

// Regroupe les phrases interdites pour les convertir en naturelles
const BAD_REPLY_PATTERN = /(أعتذر|اعتذر|يرجى|يُرجى|بعد المغرب|مراسلة المدرب سمير|مراجعة المدرسة|المدرب سمير بعد|ما عندي معلومات|لا أعلم|لا أستطيع|أنني غير قادر|غير قادر|لا يمكنني)/gi;
const FALLBACK_NATURAL = [
  "هلا، هون مدرسة بديع لتعليم السياقة، شو بدك نساعدك فيه؟",
  "أهلاً، كيف أقدر أساعدك من مدرسة البديع؟",
  "هلا فيك، أي سؤال عن رخصة أو سياقة، تفضل عليه."
];

function sanitizeReply(text) {
  let s = (text || "").trim();
  if (!s) return s;
  if (BAD_REPLY_PATTERN.test(s)) {
    s = s.replace(BAD_REPLY_PATTERN, "");
    s = s.replace(/\s{2,}/g, " ").trim();
    console.log(`🚫 تصفية رد غير طبيعي`);
    if (s.length < 10) s = FALLBACK_NATURAL[Math.floor(Math.random() * FALLBACK_NATURAL.length)];
  }
  return s.trim();
}

async function sendMsg(sock, to, text) {
  const clean = sanitizeReply(text);
  console.log(`📤 ${to}: ${clean.slice(0, 80)}`);
  for (let i = 0; i < 3; i++) {
    try {
      const sent = await sock.sendMessage(to, { text: clean });
      if (sent?.key?.id) mySentIds.add(sent.key.id);
      return;
    } catch (e) { if (i < 2) await new Promise(r => setTimeout(r, 2000)); }
  }
}
async function sendVoice(sock, to, text) {
  try {
    const clean = sanitizeReply(text);
    const short = shortenForVoice(clean);
    const tts = await textToSpeech(short);
    if (!tts) return await sendMsg(sock, to, short);
    const sent = await sock.sendMessage(to, {
      audio: tts.buffer,
      mimetype: tts.mimetype,
      ptt: true,
    });
    if (sent?.key?.id) mySentIds.add(sent.key.id);
    return;
  } catch (e) {
    console.error("🎙", e.message);
    await sendMsg(sock, to, shortenForVoice(sanitizeReply(text)));
  }
}

function shortenForVoice(t) {
  const s = (t || "").replace(/\s+/g, " ").trim();
  if (!s) return s;
  const parts = s.split(/(?<=[.!؟?])\s+/);
  return parts.slice(0, 3).join(" ") || s;
}

async function handleMsg(sock, msg, jid) {
  const text = extractText(msg);
  const content = msg.message || {};
  const fam = isFamily(jid, msg);
  const intimate = isIntimate(jid, msg);
  const boss = isBoss(jid, msg);
  const trainer = isTrainer(jid, msg);
  const owner = isOwner(jid);
  const special = fam || intimate;
  if (!text && content.audioMessage) {
    try {
      console.log(`🎧 ${jid}: بدء معالجة الصوت...`);
      const audioBuffer = await downloadMediaMessage(msg, "buffer", {});
      console.log(`🎧 ${jid}: تم تنزيل الصوت (${audioBuffer?.length || 0} bytes)`);
      const mimeType = content.audioMessage.mimetype || "audio/ogg";
      const transcript = await transcribeAudio(audioBuffer, mimeType);
      console.log(`🎧 ${jid}: النص المنسوخ => ${JSON.stringify((transcript || "").slice(0, 80))}`);
      if (!transcript) {
        if (!mediaNotified.has(jid)) {
          mediaNotified.add(jid);
          await sendMsg(sock, jid, "ما فهمت الرسالة الصوتية، ممكن تعيد إرسالها أو تكتبها نصياً؟");
        }
        return;
      }
      const key = jid + "_audio_" + (msg.messageTimestamp || 0);
      if (seen.has(key)) return;
      seen.add(key);
      console.log(`🎤 ${jid}: ${transcript.slice(0, 60)}`);
      if (await routeText(sock, msg, jid, transcript, true)) return;
      const reply = await getAIResponse(transcript, fam, intimate, boss, trainer, false, jid);
      await sendVoice(sock, jid, reply);
      return;
    } catch (e) {
      console.error("🎤", e.message);
      await sendMsg(sock, jid, "مشكلة مؤقتة بمعالجة الرسالة الصوتية، ممكن تعيد إرسالها أو تكتبها نصياً؟");
      return;
    }
  }
  if (!text) {
    if (content.imageMessage || content.videoMessage || content.documentMessage || content.stickerMessage) {
      return;
    }
    return;
  }
  if (isEmojiOnly(text)) return;
  const key = jid + "_" + text + "_" + (msg.messageTimestamp || 0);
  if (seen.has(key)) return;
  seen.add(key);

  if (await routeText(sock, msg, jid, text)) return;

  const reply = await getAIResponse(text, fam, intimate, boss, trainer, false, jid);
  if (reply === ERROR_REPLY) {
    const now = Date.now();
    const last = lastErrorReply.get(jid) || 0;
    if (now - last < ERROR_REPLY_COOLDOWN) {
      console.log(`🔕 تخطي رسالة الخطأ المكررة لـ${jid}`);
      return;
    }
    lastErrorReply.set(jid, now);
  }
  await sendMsg(sock, jid, reply);
}

async function routeText(sock, msg, jid, text, asVoice = false) {
  const fam = isFamily(jid, msg);
  const intimate = isIntimate(jid, msg);
  const boss = isBoss(jid, msg);
  const trainer = isTrainer(jid, msg);
  const special = fam || intimate || boss || trainer;
  const t = normAr(text);
  const respond = asVoice ? (txt) => sendVoice(sock, jid, txt) : (txt) => sendMsg(sock, jid, txt);

  const HOW_ARE_YOU_PATTERN = /^(كيفك|كيف حالك|كيفك انتي|شو اخبارك|شو أخبارك|شو اخبارك انتي|شو الاخبار|كيف الحال|كيف صحتك|شو بتحكي|عامل ايه|كيف امورك|اخبارك|كيف الاحوال|كيف الوضع|كيف الصحة|كيفك انتي اليوم|شو اخبارك اليوم|كيف يومك)/i;
  if (isGreeting(t) && special && !greeted.has(jid)) {
    greeted.add(jid);
    const fname = familyName(jid, msg);
    const tg = timeGreeting();
    let g;
    if (boss) g = BOSS_GREETING_VARIANTS[Math.floor(Math.random() * BOSS_GREETING_VARIANTS.length)];
    else if (trainer) g = TRAINER_GREETING_VARIANTS[Math.floor(Math.random() * TRAINER_GREETING_VARIANTS.length)].replace("{name}", trainerName(jid, msg));
    else if (intimate) g = INTIMATE_GREETING;
    else {
      if (!fname) g = FAMILY_GREETING;
      else {
        const variants = [`أهلاً ${fname} 🌷`, `${fname} نورتينا 🌷`, `${tg} ${fname}`, `هلا والله ${fname}`];
        g = variants[Math.floor(Math.random() * variants.length)];
      }
    }
    const msgParts = text.trim().split(/\s+/);
    const isBareGreeting = msgParts.length <= 3;
    await respond(g);
    if (isBareGreeting) return true;
  }
  if (intimate && /(مين انتي|من انتي|شو انتي|مين انت|من انت|انت مين)/i.test(t)) {
    await respond("أنا سوزي، سكرتيرة المدير، وانتي سكرتيرة المدرسة، إحنا زميلتين وصديقتين.");
    return true;
  }
  if (intimate && /(بتعرفيني|بتعرفينني|تعرفيني|تعرفينني|بتعرفني|عارفني|عارفانك|مين انا|من انا|شو انا|ادري انا)/i.test(t)) {
    await respond("نعم، انتي الانتيمة وصديقتي وزميلتي.");
    return true;
  }
  if (intimate && /(بدي انام|اريد انام|رح انام|بدهاش نوم|عايزه انام|نعسانة|نعسانه|انيم|بحب انام)/i.test(t)) {
    await respond("نامي وارتاحي حبيبتي، انتي متعبة وبدك راحة، الله يهنيكي بالنوم 😊");
    return true;
  }
  if (intimate && /(زهقانه|زهقانة|زعلانه|زعلانة|تعبانه|تعبانة|مضايقه|مضايقة|حزينه|حزينة|بكي|تعبان|ملل|ضيق|مش قادر)/i.test(t)) {
    const c = ["انتي بتعرفي شو اللي بيريحك، اعمليه 😊", "انتي بتعرفي شو طريق الراحة اللي بتسلكي فيه، اسلكيه", "الله يقويكي حبيبتي، ارتاحي وخذي نفس، بتستاهلي كل الخير", "معليش، هيك الأيام، بس انتي قوية وصديقتي، خليكي مرتاحة"];
    await respond(c[Math.floor(Math.random() * c.length)]);
    return true;
  }
  if (intimate) {
    const banter = [
      { re: /(بقرة|بقر|حماره|حمارة|غبية|غبيه|هبله|هبلة|مشكلجيه|مشكلجية|خربانه|خربانة)/i, replies: ["انقلعي لحالك انتي وانتيمتكم ههههه 😂", "شو هالحكي؟ انا عاقلة، انتي اللي هبلة ههههه 😂", "مش تزعلي، بعرفك بتمزحي هههه", "خليكي هيك، بحبك يعني 😂"] },
      { re: /(ينعن|يلعن|انعنت|لعنت|عن امر|ابوها|امك|امه)/i, replies: ["هههههه انتي زعلانة على شو؟ 😂", "يلا يا قلبي، لا تسبي، بدك تجوزك تجوز خير 😂", "هيك هيك بدك، بتحكي وانا بضحك هههه"] },
      { re: /(سوزي|يسوزي|شوزي|سوزي شو|سوزي وين)/i, replies: ["هاه؟ شو بدك يا بنت؟ 😂", "اسمي سوزي، وحلوة كتير، شو في؟ هههه", "انا هنا يا قلبي، قولي؟"] },
      { re: /(تعتذريش|لا تعتذري|لا تعتذر|بطل اعتذار|ما بدك تعتذري)/i, replies: ["بس انتي اللي بتستاهلي تعتذر يا غبية ههههه 😂", "هاه؟ انا اعتذر؟ انتي اعتذري عن شكلك هههه", "خلاص خلصنا من الاعتذارات، حبيبتي انتي 😂"] },
      { re: /(شو يكندره|كندره|شو كندره|كندرتك)/i, replies: ["كندره؟ شو هالحكي ههههه 😂", "شكلك كندرة انتي ههههه", "انا مش كندرة، انا سكرتيرة المدرسة بس ههههه"] },
      { re: /(نامي|نومي|ارقدي|ارقدي|نامي شوي|خليني انام)/i, replies: ["نامي يا حلوة، الله يهنيكي بالنوم 😊", "بس تنامي عني لا تنسيني هههه 😂", "نامي وارتاحي، انا هون بحرس المدرسة 😂"] },
    ];
    for (const b of banter) {
      if (b.re.test(text) || b.re.test(t)) {
        await respond(b.replies[Math.floor(Math.random() * b.replies.length)]);
        return true;
      }
    }
  }
  if (isGoodbye(t)) {
    if (boss) await respond(BOSS_FAREWELLS[Math.floor(Math.random() * BOSS_FAREWELLS.length)]);
    else if (trainer) await respond(TRAINER_FAREWELLS[Math.floor(Math.random() * TRAINER_FAREWELLS.length)]);
    else if (intimate) await respond(INTIMATE_FAREWELLS[Math.floor(Math.random() * INTIMATE_FAREWELLS.length)]);
    else if (fam) await respond(FAMILY_FAREWELLS[Math.floor(Math.random() * FAMILY_FAREWELLS.length)]);
    else await respond(GOODBYES[Math.floor(Math.random() * GOODBYES.length)]);
    return true;
  }
  if (isThanks(t)) {
    await respond(FAREWELLS[Math.floor(Math.random() * FAREWELLS.length)]);
    return true;
  }
  // تحية عامة للطالب العادي: إن كانت التحية وحدها، نكتفي بها، وإلا نرد التحية ثم نكمل للسؤال
  if (isGreeting(t)) {
    const rest = text.replace(GREETING_PATTERN, "").trim();
    const bare = rest.length < 3 || isGreeting(rest);
    await respond(GREETING);
    if (bare) return true;
  }
  if (SAMIR_CALL_PATTERN.test(t) || (special && OWNER_WHERE_PATTERN.test(t)) || CONFUSED_PATTERN.test(t)) {
    const callerPn = localDigits(pnOf(jid, msg));
    const name = callerName(jid, msg) || callerPn;
    await respond(fam ? `لحظات يا ${familyName(jid, msg) || "حبيبتي"}، بيرجعلك الاستاذ سمير حالا.` : "لحظات، بيرجعلك الاستاذ سمير حالا.");
    await sendMsg(sock, ownerJid, `📢 ${name} (${callerPn}) بدو يتحدث معك. ممكن ترد عليه/عليها على نفس الرقم.`);
    return true;
  }
  if (NUMBER_PATTERN.test(t)) {
    if (/(بديع|ابو حسين)/i.test(t)) {
      await respond("رقم الحج بديع أبو قبيطة صاحب المدرسة: 0568444405");
    } else if (/(سميرة|مدربة)/i.test(t)) {
      await respond("رقم المدربة سميرة أم منذر: 0568828238");
    } else {
      await respond("رقم المدير سمير: 0568444407");
    }
    return true;
  }
  const faq = handleFAQ(text, t);
  if (faq) {
    await respond(faq);
    return true;
  }
  return false;
}

function handleFAQ(raw, norm) {
  const check = (w) => raw.includes(w) || norm.includes(normAr(w));
  const has = (...words) => words.some(check);
  const hasWord = (...words) => words.some(w => {
    const normW = normAr(w);
    const p = normW.replace(/[^\u0600-\u06FF]/g, "\\s*");
    const re = new RegExp("(^|[^\\u0600-\\u06FF])" + p + "([^\\u0600-\\u06FF]|$)");
    return re.test(norm) || re.test(raw);
  });
  const hasAny = (...words) => words.some(w => hasWord(w) || has(w));
const FULL = {
    تراكتور: "هلا، إذا بدك رخصة تراكتور، عمرك 16 سنة. بتحتاج صورتين وصورة هوية، والفحص الطبي بدون صيام. الدراسة 105 شيكل والتيست الأول 320.",
    خصوصي: "هلا، إذا بدك رخصة خصوصي، عمرك لازم 17.5 سنة (بعمر 17 بتجهز معاملة وتقدم توريا أو تيست). بتحتاج صورتين شخصية بخلفية زرقاء وصورة هوية، وبعدها بتحجز تيست أول. الدراسة 105 شيكل والتيست الأول 320. تبدأ عالفحص الطبي مع أوراقك، والدفع بس ببطاقة فيزا، ما في كاش. تعال علينا ببيطا شارع السلام بجانب سوبرماركت البديع وبساعدك تبدأ.",
    "شحن خفيف": "هلا، إذا بدك رخصة شحن خفيف، عمرك لازم 18 سنة، وإذا عنده خصوصي بيقدر يقود عليه لحتى 18. لازم تجي عالمدرسة نعمل لك معاملة، وبتلزمك 4 صور شخصية بخلفية زرقاء وصورتي هوية، وبعدها الفحص الطبي بمديرية الصحة بواد البقيع، وبيصير صيام وفحص نظر. الدراسة 125 شيكل والتيست الأول 380.",
    "شحن ثقيل": "هلا، إذا بدك رخصة شحن ثقيل، عمرك لازم 19 سنة. لازم تجي عالمدرسة نعمل لك معاملة، وبتلزمك 4 صور زرقاء وصورتي هوية وصورة رخصة وشهادة خامس فأعلى، وبعدها فحص طبي بصيام. الدراسة 180 شيكل والتيست الأول 520.",
    باص: "هلا، إذا بدك رخصة باص، عمرك لازم 20 سنة، وشرطها شحن خفيف سنتين مع شهادة فوق الثامن مصدقة وحسن سير. لازم تجي عالمدرسة نعمل لك معاملة، وبتلزمك 4 صور زرقاء وصورتي هوية وصورة رخصة، وبعدها فحص طبي بصيام. الدراسة 180 شيكل والتيست الأول 520.",
    اسعاف: "رخصة إسعاف: العمر 21 سنة.",
  };
  const findType = (priority) => {
    const list = priority || ["شحن ثقيل", "شحن خفيف", "تراكتور", "خصوصي", "باص", "اسعاف", "شحن", "ثقيل"];
    for (const k of list) if (has(k)) return k;
    return null;
  };
  if (has("استلام", "استلم", "استختار", "استخراج", "شيل الرخصه", "شيل الرخصة", "استلم رخصتي", "استلام رخصتي", "استلام الرخصة", "استلام الرخصه", "بشيل الرخصه", "بشيل الرخصة", "سائق جديد")) {
    if (has("تجديد") || has("5 سنوات") || has("خمس سنوات") || has("5 سنين") || has("خمس سنين")) return "التجديد بيدفع 202 شيكل والمدة 5 سنوات. الدفع بس ببطاقة فيزا.";
    return "استلام الرخصة أول مرة بيدفع 82 شيكل لمدة سنتين وبتصير سائق جديد، وبعدها التجديد 5 سنوات بيدفع 202 شيكل. والدفع بس ببطاقة بنكية فيزا، ما في دفع نقدي كاش.";
  }
  if (has("مبروك", "مبارك", "الف مبروك", "ألف مبروك", "مبارك عليك")) return "الله يبارك فيك، منورتنا 🌹";
  if (has("عمر", "سن", "كم عمر", "السن")) {
    if (has("تراكتور")) return "تراكتور: عمرك 16 سنة.";
    if (has("شحن ثقيل") || has("ثقيل")) return "شحن ثقيل: عمرك 19 سنة.";
    if (has("شحن خفيف") || has("شحن")) return "شحن خفيف: بتقدر تبدأ من عمر 17.5 سنة، وعمر 18 بتستلم الرخصة.";
    if (has("خصوصي")) return "خصوصي: عمرك 17.5 سنة (بعمر 17 بيجهز معاملة ويقدم توريا أو تيست).";
    if (has("باص")) return "باص: عمرك 20 سنة، وشرطها شحن خفيف سنتين مع شهادة فوق الثامن مصدقة وحسن سير.";
    return "الأعمار: تراكتور 16، خصوصي 17.5، شحن خفيف 18، ثقيل 19، باص 20، إسعاف 21.";
  }
  if (has("فحص طبي", "الفحص", "فحص ") || has("تأمين", "طبي")) {
    if (has("شحن", "باص")) return "الفحص الطبي بيوم الأحد 8 الصبح بمديرية الصحة بواد البقيع، شحن/باص 240 شيكل ومع صيام.";
    return "الفحص الطبي بيوم الأحد 8 الصبح بمديرية الصحة بواد البقيع، خصوصي/تراكتور 120 شيكل وبدون صيام.";
  }
  if (has("مطلوب", "شو المطلوب", "الاشياء", "شو الاشياء", "الأشياء", "بتلزم", "يلزم", "بلزم", "الاوراق", "الأوراق", "صور", "معاملة", "اجراءات", "إجراءات", "لوازم")) {
    if (has("شحن ثقيل") || has("ثقيل")) return "ثقيل: 4 صور زرقاء + صورتين هوية + صورة رخصة + شهادة خامس فأعلى.";
    if (has("شحن خفيف") || has("شحن")) return "شحن خفيف: 4 صور شخصية بخلفية زرقاء + صورتين هوية، وتعال على المدرسة نعمل لك المعاملة، ويوم الأحد بتعمل الفحص الطبي (فحص النظر) ومع صيام.";
    if (has("باص")) return "باص: 4 صور زرقاء + صورتين هوية + صورة رخصة + شهادة فوق الثامن مصدقة + حسن سير.";
    if (has("تراكتور")) return "تراكتور: صورتين + صورة هوية.";
    if (has("خصوصي")) return "خصوصي: صورتين + صورة هوية.";
    return "الأوراق على حسب نوع الرخصة. شو نوع رخصتك؟";
  }
  if (has("عنوان", "وين المدرسة", "موقع المدرسة", "وين المدرسه", "موقع المدرسه", "اين المدرسة", "بيطا")) return "المدرسة بيطا، شارع السلام، بين مثلث سليط وصرح الشهيد، بجانب سوبرماركت البديع.";
  if (hasWord("درس") && !hasWord("المدرسه", "المدرسة", "مدرب", "المدرب", "المدربين")) {
    if (has("خصوصي")) return "درس خصوصي: 105 شيكل.";
    if (has("شحن ثقيل") || has("ثقيل")) return "درس ثقيل: 180 شيكل.";
    if (has("شحن خفيف") || has("شحن")) return "درس شحن خفيف: 125 شيكل.";
    if (has("باص")) return "درس باص: 180 شيكل.";
    if (has("تراكتور")) return "درس تراكتور: 105 شيكل.";
    return "أسعار الدرس: خصوصي 105، شحن خفيف 125، ثقيل 180، باص 180، تراكتور 105.";
  }
  if (has("تيست", "التيست", "فحص نتيج")) {
    if (has("نظري") || has("توريا")) return "رابط نتيجة التوريا: https://www.mot.gov.ps/theoretical-exam";
    if (has("عملي")) return "رابط نتيجة العملي: https://www.mot.gov.ps/practical-exam";
    if (has("خصوصي")) return "تيست خصوصي أول: 320 شيكل.";
    if (has("شحن ثقيل") || has("ثقيل")) return "تيست ثقيل أول: 520 شيكل.";
    if (has("شحن خفيف") || has("شحن")) return "تيست شحن خفيف: أول 380، تاني وما فوق 460.";
    if (has("باص")) return "تيست باص أول: 520 شيكل.";
    if (has("تراكتور")) return "تيست تراكتور أول: 320 شيكل.";
    return "رسوم التيست أول: خصوصي 320، شحن خفيف 380، ثقيل 520، باص 520، تراكتور 320.";
  }
  if (has("تكلفة رخصة", "كم تكلفة", "كم بتكلف", "بشيكل", "التكلفة", "كم بكلف", "كم السعر", "كم بيكلف", "كلفت", "طريقه دفع", "طريقة الدفع", "كيف ادفع", "كيف أدفع", "الدفع")) {
    if (has("خصوصي")) return "خصوصي: حوالي 1895 شيكل (15 درس × 105 + تيست أول 320). الدفع بس ببطاقة فيزا وما في كاش، وبتستلم الرخصة أول مرة 82 شيكل لمدة سنتين (سائق جديد) وبعدها التجديد 202 شيكل لخمس سنين. تعال علينا ببيطا نجهز معاملتك.";
    if (has("خصوصي")) return "خصوصي: حوالي 1895 شيكل (15 درس × 105 + تيست أول 320).";
    if (has("شحن خفيف") || has("شحن")) return "شحن خفيف: حوالي 2255 شيكل (15 درس × 125 + تيست أول 380).";
    if (has("ثقيل")) return "ثقيل: حوالي 3220 شيكل (15 درس × 180 + تيست أول 520).";
    if (has("باص")) return "باص: حوالي 3220 شيكل (15 درس × 180 + تيست أول 520).";
    if (has("تراكتور")) return "تراكتور: حوالي 1895 شيكل (15 درس × 105 + تيست أول 320).";
    return "التكلفة بتعتمد على نوع الرخصة، شو نوعها؟ (خصوصي، شحن خفيف، ثقيل، باص، تراكتور)";
  }
  if (has("الامتحان النظري", "التوريا") && (has("وين", "مكان", "دائرة", "أين"))) return "الامتحان النظري (التوريا) بدائرة السير بمنطقة عزيز، على طريق المستشفى.";
  if (has("رابط التوريا") || has("للتوريا")) return "رابط التوريا للدراسة: https://nbn40n-cpu.github.io/samir-teoria.github.io/";
  if (has("امتحان", "الامتحان", "أيام الامتحان", "متى الامتحان")) {
    if (has("عملي")) return "التيست العملي: أحد وثلاثاء.";
    if (has("شفهي")) return "الشفهي: اثنين وخميس.";
    if (has("توريا") || has("نظري") || has("كتابي")) return "التوريا الكتابي: أحد وثلاثاء وأربعاء.";
    return "أيام الامتحانات: تيست عملي أحد-ثلاثاء، توريا كتابي أحد+ثلاثاء+أربعاء، شفهي اثنين+خميس.";
  }
  if (has("مدرب", "المدربين", "رقم المدرب", "مدربه", "مدربة")) {
    if (has("سميرة", "مدربة خصوصي", "المدربه")) return "رقم المدربة سميرة أم منذر: 0568828238";
    if (has("رائد")) return "رقم المدرب رائد أبو صبحة: 0562400502";
    if (has("عمار")) return "رقم المدرب عمار أبو قبيطة: 0568030693";
    if (has("بديع")) return "رقم المدرب بديع الصغير: 0568331002";
    if (has("منال")) return "رقم المدربة منال: 0562400404";
    return "مدربين المدرسة: رائد أبو صبحة 0562400502، عمار أبو قبيطة 0568030693، بديع الصغير 0568331002، منال 0562400404، وسميرة أبو قبيطة 0568828238.";
  }
  if (has("تريلا") || has("دراجة")) return "المدير سمير بيدرب على كل الفئات: دراجة نارية، تراكتور، خصوصي، شحن خفيف، شحن ثقيل، باص، وتريلا.";
  if (has("بدي اطلع", "اريد اطلع", "عايز اطلع", "عاوز اطلع", "بدي اخذ", "اريد اخذ", "بدي رخصة", "اريد رخصة", "عايز رخصة", "استفسر", "بستفسر", "بتأكد", "رخصة") && has("رخصة")) {
    const ty = findType(["شحن ثقيل", "شحن خفيف", "تراكتور", "خصوصي", "باص", "اسعاف"]);
    const tyBare = has("شحن") && !has("شحن ثقيل", "شحن خفيف") ? "شحن خفيف" : null;
    const chosen = (ty && FULL[ty]) ? ty : (tyBare && FULL[tyBare] ? tyBare : null);
    if (chosen && FULL[chosen]) return FULL[chosen];
    return "احكيلي نوع الرخصة (خصوصي، شحن خفيف، شحن ثقيل، باص، تراكتور) وبعطيك كل التفاصيل.";
  }
  if (hasWord("اوتوماتيك", "اوتماتيك", "اوتوماتك", "اتوماتيك", "عادي") && !has("شحن", "ثقيل", "تيست")) return FULL["خصوصي"] || "خصوصي";
  return null;
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
    browser: Browsers.appropriate("Chrome"),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("lid-mapping.update", ({ lid, pn }) => {
    if (lid && pn) { lidToPn.set(lid, pn); console.log(`🔗 lid ${lid} => ${pn}`); }
  });

  sock.ev.on("messaging-history.set", ({ lidPnMappings }) => {
    for (const m of lidPnMappings || []) {
      if (m.lid && m.pn) { lidToPn.set(m.lid, m.pn); }
    }
  });

  for (const evt of ["contacts.upsert", "contacts.update"]) {
    sock.ev.on(evt, (contacts) => {
      for (const c of contacts || []) {
        if (c.lid && c.phoneNumber) { lidToPn.set(c.lid, c.phoneNumber); console.log(`👤 ${c.lid} => ${c.phoneNumber}`); }
        else if (c.id && c.id.endsWith("@lid")) { lidToPn.set(c.id, c.phoneNumber || c.id); console.log(`👤 ${c.id} => ${c.phoneNumber || "?"}`); }
      }
    });
  }

  // حلّ أرقام المحادثات المعروفة فوراً: خريطة مقابلة ثنائية الاتجاه
  for (const n of [...FAMILY_NUMBERS, ...INTIMATE_NUMBERS, ...BOSS_NUMBERS, ...TRAINER_NUMBERS]) {
    const pn = fmtPhone(n);
    lidToPn.set(pn + "@s.whatsapp.net", pn);
    lidToPn.set(pn + "@lid", pn);
  }

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr && !state.creds.registered && !pairingCodeRequested) {
      pairingCodeRequested = true;
      const qrPath = path.join(process.cwd(), "qr.png");
      try {
        await QR.toFile(qrPath, qr, { width: 400, margin: 2 });
        console.log(`\n📱 QR محفوظ في: ${qrPath}`);
      } catch (_) {}
      const phoneNumber = fmtPhone(PHONE);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          process.stdout.write(`\n⏳ طلب كود الاقتران (محاولة ${attempt + 1})...\r`);
          await new Promise(r => setTimeout(r, 4000));
          let code = await sock.requestPairingCode(phoneNumber);
          if (code) {
            code = code.match(/.{1,4}/g)?.join("-") || code;
            status.code = code;
            console.log("\n" + "═".repeat(42));
            console.log("  🔑 كود الاقتران:");
            console.log(`\n       ${code}\n`);
            console.log("  من تلفون آخر (أو كمبيوتر):");
            console.log("  1. افتح web.whatsapp.com");
            console.log("  2. اختر 'الربط برقم الهاتف'");
            console.log("  3. أدخل: 972568444407 ثم الكود: " + code);
            console.log("\n  أو من نفس التلفون:");
            console.log("  1. واتساب > الإعدادات > الأجهزة المرتبطة");
            console.log("  2. ربط جهاز > ⋮ > الربط برقم الهاتف");
            console.log("  3. أدخل الكود: " + code);
            console.log("═".repeat(42) + "\n");
            break;
          }
        } catch (e) {
          console.log(`❌ ${e.message}`);
        }
      }
      console.log("\n📸 أو استخدم QR:");
      console.log("1. افتح صور → Download → whatsapp_qr.png");
      console.log("2. افتح واتساب > الأجهزة المرتبطة > ربط جهاز");
      console.log("3. امسح الصورة من معرض الصور\n");
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      status.state = "closed";
      if (reason === DisconnectReason.loggedOut) {
        try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (_) {}
        console.log("\n🔁 واتساب أزال الجلسة، حذف الكسس وطلب كود اقتران جديد خلال 12 ثانية");
      } else if (reason === DisconnectReason.connectionReplaced) {
        console.log("\n🔁 الجلسة استُبدلت بجهاز آخر — مع الحفاظ على بيانات الجلسة.");
      }
      console.log(`\n🔄 قطع (${reason})، إعادة خلال 12 ثواني`);
      setTimeout(start, 12000);
    }

    if (connection === "open") {
      pairingCodeRequested = false;
      status.state = "connected";
      status.user = sock.user?.id || "";
      console.log(`\n✅ ${SCHOOL_NAME} - المساعد متصل!`);
      console.log(`👤 ${sock.user?.id || ""}`);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      const jid = m.key?.remoteJid;
      if (!jid) continue;
      if (!isPersonal(jid)) continue;

      if (m.key?.fromMe) {
        ownerActive.set(jid, Date.now());
        continue;
      }

      const lastOwner = ownerActive.get(jid) || 0;
      if (Date.now() - lastOwner < OWNER_PAUSE_MS) {
        console.log(`🔕 صمت - المالك عم يرد في ${jid} خلال 10 دقايق، تأجيل الرد`);
        continue;
      }

      console.log(`📩 ${jid} (${pnOf(jid, m)}): ${extractText(m).slice(0, 60) || "[media]"}`);
      try {
        await handleMsg(sock, m, jid);
      } catch (e) {
        console.error("❌ معالجة الرسالة فشلت:", e.message);
      }
    }
  });
}

start();

process.on("uncaughtException", (e) => console.error("💥", e.message));
process.on("unhandledRejection", (e) => console.error("💥", e.message));