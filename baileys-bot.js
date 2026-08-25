import "dotenv/config";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, downloadMediaMessage } from "@whiskeysockets/baileys";
import { getAIResponse, transcribeAudio, textToSpeech, ERROR_REPLY } from "./ai.js";
import { loadStore, getStore, saveStore, updateStore } from "./store.js";
import { bumpCounter, setLastError, setLastStart, pushEvent, trackChat } from "./stats.js";
import { startPanel, setPaused, getControl } from "./panel/server.js";
import { findStoreReply } from "./router.js";
import path from "path";
import fs from "fs";
import QR from "qrcode";

const SCHOOL_NAME = "مدرسة بديع لتعليم السياقة";
const PHONE = process.env.SCHOOL_PHONE || "0568444407";
let FAMILY_NUMBERS = ["0568828240", "0569268867", "0568828238"];
let FAMILY_NAMES = { "0568828240": "نهال أم محمد", "0569268867": "هدى أم آدم", "0568828238": "سميرة أم منذر" };
let INTIMATE_NUMBERS = ["0598742654"];
let SIBLINGS_NUMBERS = [];
let SIBLINGS_NAMES = {};
const RELATIVE_INFO = new Map();
let BOSS_NUMBERS = ["0568444405"];
let TRAINER_NUMBERS = ["0562400502", "0568030693", "0568331002", "0562400404"];
let TRAINER_NAMES = { "0562400502": "رائد أبو صبحة", "0568030693": "عمار أبو قبيطة", "0568331002": "بديع الصغير", "0562400404": "منال" };
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
const STUDENT_GREETING_VARIANTS = ["أهلاً {name} 🌹 {tg}", "هلا والله {name} 😊 {tg}", "{tg} {name} 🌹", "أهلاً وسهلاً {name} 🌹 {tg}"];
const FAMILY_GREETING = "هلا نورتينا 🌷";
const INTIMATE_GREETING = "هلا والله انتيمة، نورتي، شو أخبارك اليوم؟";
const INTIMATE_OWNER_REPLY = "إذا في أمر ضروري اتصلي مباشرة بحبيبك، وإذا مش ضروري بس يشوف الرسالة رح يرجعلك لأنه مضغوط معه درس عملي.";
const INTIMATE_FAREWELLS = ["مع السلامة، يومك سعيد، انبسطت بالحديث معك يا صديقتي، ديري بالك على حالك.", "مع ألف سلامة حبيبتي، إلهي يومك سعيد، كل ما بدك إياه إحنا موجودين، ديري بالك."];
const FAMILY_FAREWELLS = ["مع السلامة حبيبتي، الله يسعدك 🌷", "مع السلامة نورتينا، ديري بالك على حالك."];
const SIBLINGS_GREETING_VARIANTS = ["هلا والله يا غالي 🌹", "أهلاً بأخ سمير، نورت 🌹", "هلا بالغالي، شو أخبارك؟"];
const SIBLINGS_FAREWELLS = ["مع السلامة يا غالي، الله يسعدك 🌹", "مع ألف سلامة يا غالي، نورت.", "يسلمو يا غالي، الله يحفظك."];
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
  "بدي اتكلم مع (الاستاذ )?(س[مم]ير|شمير)",
  "(يا|هلا|وعليك|عليك|معك) (الاستاذ )?(س[مم]ير|شمير)",
  "^\\s*(الاستاذ )?(س[مم]ير|شمير)"
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
const lastStudentQ = new Map();
const lastBotReply = new Map();
const lastTypeByChat = new Map();
const LEARN_TYPE_TTL = 6 * 60 * 60 * 1000;
const LICENSE_TYPES = ["خصوصي", "شحن خفيف", "شحن ثقيل", "باص", "تراكتور", "اسعاف"];
const LESSON_PRICE = { "خصوصي": 105, "شحن خفيف": 125, "شحن ثقيل": 180, "باص": 180, "تراكتور": 105 };
const TEST_PRICE = { "خصوصي": 320, "شحن خفيف": 380, "شحن ثقيل": 520, "باص": 520, "تراكتور": 320 };
const ERROR_REPLY_COOLDOWN = 30 * 60 * 1000;
const authPath = path.join(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || ".", "baileys_auth");

let status = { state: "starting", code: null, user: null, startedAt: Date.now() };

function isPersonal(from) { return from && !from.endsWith("@g.us") && from !== "status@broadcast"; }
function isGreeting(text) { return GREETING_PATTERN.test(text.trim()); }
function isThanks(text) { return THANKS_PATTERN.test(text.trim()); }
function isGoodbye(text) { return GOODBYE_PATTERN.test(text.trim()); }
const END_CHAT_WORDS = ["ماشي", "تمام", "تمامم", "اوك", "اوكي", "اوكيه", "خلاص", "يسلمو", "تسلم", "تسلمو", "شكرا", "انشالله", "انشاءالله", "شاءالله", "ان", "شاء", "الله", "يالله", "يللا", "مع", "السلامه", "سلام", "باي", "بي"];
function isEndChat(text) {
  const s = (text || "").trim();
  if (!s || s.length > 40 || /[؟?]/.test(s)) return false;
  if (/^(ok|okay|okei)[\s!.]*$/i.test(s)) return true;
  const toks = normAr(s).split(/\s+/).filter(Boolean);
  if (!toks.length || toks.length > 4) return false;
  return toks.every((w) => END_CHAT_WORDS.includes(w));
}
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
function isSibling(from, msg) { const pn = pnOf(from, msg); return SIBLINGS_NUMBERS.some(n => matchesPn(pn, n)); }
function siblingName(from, msg) { const pn = pnOf(from, msg); const n = SIBLINGS_NUMBERS.find(n => matchesPn(pn, n)); return SIBLINGS_NAMES[n] || ""; }
function relativeNote(from, msg) {
  const pn = pnOf(from, msg);
  const key = SIBLINGS_NUMBERS.find(n => matchesPn(pn, n));
  const info = key ? RELATIVE_INFO.get(key) : null;
  if (!info) return "";
  const bits = [];
  if (info.name) bits.push(`اسمه ${info.name}`);
  if (info.relation) bits.push(`${info.relation} لسمير`);
  let t = "\n[الشخص اللي عم تحكي معه الآن: ";
  t += bits.length ? bits.join("، ") : "قريب من سمير";
  if (info.notes) t += ` — ملاحظات: ${info.notes}`;
  if (info.styleNote) t += ` — أسلوب التعامل معه: ${info.styleNote}`;
  return t + ". استخدمي هالمعلومات بالنداء والأسلوب فقط، ولا تخترعي معلومات غيرها]\n";
}
function isBoss(from, msg) { const pn = pnOf(from, msg); return BOSS_NUMBERS.some(n => matchesPn(pn, n)); }
function isTrainer(from, msg) { const pn = pnOf(from, msg); return TRAINER_NUMBERS.some(n => matchesPn(pn, n)); }
function trainerName(from, msg) { const pn = pnOf(from, msg); const n = TRAINER_NUMBERS.find(n => matchesPn(pn, n)); return TRAINER_NAMES[n] || ""; }
function familyName(from, msg) { const pn = pnOf(from, msg); const n = FAMILY_NUMBERS.find(n => matchesPn(pn, n)); return FAMILY_NAMES[n] || ""; }
function studentName(from, msg) { const pn = pnOf(from, msg); const num = Object.keys(STUDENT_NAMES).find(n => matchesPn(pn, n)); return num ? STUDENT_NAMES[num] : ""; }
function callerName(from, msg) { return siblingName(from, msg) || familyName(from, msg) || studentName(from, msg) || (isTraining(from) ? trainerName(from, msg) : "") || (isIntimate(from, msg) ? "الانتيمة" : ""); }
function isTraining(from, msg) { return isTrainer(from, msg) || isBoss(from, msg); }
function learnStudentName(jid, msg, text) {
  try {
    if (isFamily(jid, msg) || isIntimate(jid, msg) || isSibling(jid, msg) || isBoss(jid, msg) || isTrainer(jid, msg) || jid === ownerJid) return;
    const m = String(text || "").match(/اسمي\s+([\u0600-\u06FF]{2,15}(?:\s+[\u0600-\u06FF]{2,15})?)/);
    if (!m) return;
    const nm = m[1].trim();
    const pn = pnOf(jid, msg);
    if (!nm || nm.length < 2 || !pn || STUDENT_NAMES[pn] === nm) return;
    STUDENT_NAMES[pn] = nm;
    updateStore((st) => { st.studentNames = st.studentNames || {}; st.studentNames[pn] = nm; return st; }).catch(() => {});
    console.log(`👤 حفظ اسم الطالب: ${nm} (${pn})`);
  } catch (_) {}
}
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
  const cleaned = (s || "").replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3\u2600-\u27BF\u2B00-\u2BFF\u00A9\u00AE\u2122\u2190-\u21FF\u2300-\u23FF\u25A0-\u25FF\u2900-\u297F\u2B00-\u2BFF]/gu, "").replace(/\s+/g, "");
  return !cleaned;
}

function recordBotReply(to, text) {
  if (to && text) lastBotReply.set(to, { a: String(text).slice(0, 400), ts: Date.now() });
}
function setTypeForChat(jid, type) {
  if (jid && LICENSE_TYPES.includes(type)) lastTypeByChat.set(jid, { type, ts: Date.now() });
}
function getTypeForChat(jid) {
  const v = lastTypeByChat.get(jid);
  if (!v) return null;
  if (Date.now() - v.ts > LEARN_TYPE_TTL) { lastTypeByChat.delete(jid); return null; }
  return v.type;
}

async function scanSuggestion(ownerA) {
  try {
    const s = await loadStore();
    let changed = false;
    const sug = (s.suggestions = s.suggestions || []);
    const TYPE_KEYS = { "خصوصي": "خصوصي", "شحن خفيف": "شحن خفيف", "شحن": "شحن خفيف", "شحن ثقيل": "شحن ثقيل", "ثقيل": "شحن ثقيل", "باص": "باص", "تراكتور": "تراكتور" };
    for (const sen of String(ownerA).split(/[.!؟\n،]+/)) {
      const nsen = normAr(sen);
      const mPrice = String(sen || "").match(/(\d{2,4})\s*شيكل/);
      if (!mPrice) continue;
      let ltype = null, field = null;
      if (/تيست|فحص نتيج/.test(nsen)) field = "testFirst";
      else if (/درس|حصه|حصة/.test(nsen)) field = "lesson";
      if (!field) continue;
      const loose = nsen.replace(/(^|\s)ال/g, "$1");
      for (const [w, tt] of Object.entries(TYPE_KEYS)) { const k = normAr(w); if (nsen.includes(k) || loose.includes(k)) { ltype = tt; break; } }
      if (!ltype) continue;
      const val = parseInt(mPrice[1], 10);
      const cur = s.prices?.[field]?.[ltype];
      if (cur == null || cur === val) continue;
      if (sug.some((x) => x.status === "pending" && x.kind === "price" && x.field === field && x.type === ltype && x.value === val)) continue;
      sug.push({ id: "sg-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: "price", field, type: ltype, value: val, old: cur, quote: sen.trim().slice(0, 160), status: "pending", ts: Date.now() });
      changed = true;
    }
    const phones = String(ownerA).match(/05\d{8}/g) || [];
    if (phones.length) {
      const knownTails = new Set();
      const addTail = (p) => { const d = String(p || "").replace(/\D/g, ""); if (d.length >= 9) knownTails.add(d.slice(-9)); };
      addTail(PHONE);
      for (const arr of [FAMILY_NUMBERS, INTIMATE_NUMBERS, SIBLINGS_NUMBERS, BOSS_NUMBERS, TRAINER_NUMBERS]) for (const p of arr || []) addTail(p);
      for (const ph of phones) {
        if (knownTails.has(ph.slice(-9))) continue;
        if (sug.some((x) => x.status === "pending" && x.kind === "phone" && x.value === ph)) continue;
        sug.push({ id: "sg-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: "phone", value: ph, quote: String(ownerA).slice(0, 160), status: "pending", ts: Date.now() });
        changed = true;
      }
    }
    if (changed) {
      if (sug.length > 30) s.suggestions = sug.slice(-30);
      await saveStore(s);
      console.log("💡 اقتراحات معلومات جديدة من ردود المدير — راجعها من تبويب تعلم سوزي");
    }
  } catch (e) { console.error("scanSuggestion:", e.message); }
}

async function captureOwnerReply(jid, m, ownerA) {
  try {
    const s = await loadStore();
    s.learning = s.learning || { examples: [], lessons: [] };
    s.learning.examples = s.learning.examples || [];
    const ex = s.learning.examples;
    const last = ex[ex.length - 1];
    if (last && last.ownerA === ownerA && Date.now() - last.ts < 90000) return;
    const stq = lastStudentQ.get(jid);
    const bot = lastBotReply.get(jid);
    ex.push({
      id: "ln-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      chat: pnOf(jid, m),
      q: stq ? stq.q : "",
      suzyA: bot ? bot.a : "",
      ownerA,
      note: "",
      status: "pending",
      ts: Date.now(),
    });
    if (ex.length > 60) s.learning.examples = ex.slice(-60);
    await saveStore(s);
    console.log(`🎓 تسجيل رد المدير للتعلم (${pnOf(jid, m)})`);
    await scanSuggestion(ownerA);
  } catch (e) { console.error("captureOwnerReply:", e.message); }
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
  pushEvent({ dir: "out", from: to, text: clean, kind: "text" }).then(v => v);
  for (let i = 0; i < 3; i++) {
    try {
      const sent = await sock.sendMessage(to, { text: clean });
      if (sent?.key?.id) mySentIds.add(sent.key.id);
      recordBotReply(to, clean);
      return;
    } catch (e) { if (i < 2) await new Promise(r => setTimeout(r, 2000)); }
  }
}
async function sendVoice(sock, to, text) {
  try {
    const clean = sanitizeReply(text);
    const short = shortenForVoice(clean);
    if (/https?:\/\//i.test(short)) return await sendMsg(sock, to, clean);
    const tts = await textToSpeech(short);
    if (!tts) return await sendMsg(sock, to, short);
    const sent = await sock.sendMessage(to, {
      audio: tts.buffer,
      mimetype: tts.mimetype,
      ptt: true,
    });
    if (sent?.key?.id) mySentIds.add(sent.key.id);
    recordBotReply(to, short);
    pushEvent({ dir: "out", from: to, text: short, kind: "voice" }).then(v => v);
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
  const sibling = isSibling(jid, msg);
  const boss = isBoss(jid, msg);
  const trainer = isTrainer(jid, msg);
  const owner = isOwner(jid);
  const special = fam || intimate || sibling;
  trackChat(jid);
  if (!text && content.audioMessage) {
    try {
      bumpCounter("messages").then(v => v);
      bumpCounter("voice").then(v => v);
      pushEvent({ dir: "in", from: jid, text: "[صوت]", kind: "voice" });
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
      const key = jid + "_" + (msg.key?.id || text + "_" + (msg.messageTimestamp || 0));
      if (seen.has(key)) return;
      seen.add(key);
      console.log(`🎤 ${jid}: ${transcript.slice(0, 60)}`);
      if (await routeText(sock, msg, jid, transcript, true)) return;
      const reply = await getAIResponse(transcript, fam, intimate, boss, trainer, false, jid, sibling, sibling ? relativeNote(jid, msg) : "");
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
  const key = jid + "_" + (msg.key?.id || text + "_" + (msg.messageTimestamp || 0));
  if (seen.has(key)) return;
  seen.add(key);
  bumpCounter("messages").then(v => v);
  pushEvent({ dir: "in", from: jid, text, kind: "text" });
  learnStudentName(jid, msg, text);
  if (await routeText(sock, msg, jid, text)) return;
  const reply = await getAIResponse(text, fam, intimate, boss, trainer, false, jid, sibling, sibling ? relativeNote(jid, msg) : "");
  if (reply === ERROR_REPLY) {
    bumpCounter("unanswered").then(v => v);
    setLastError("ذكاء عجز عن الرد لـ" + jid);
    const now = Date.now();
    const last = lastErrorReply.get(jid) || 0;
    if (now - last < ERROR_REPLY_COOLDOWN) {
      console.log(`🔕 تخطي رسالة الخطأ المكررة لـ${jid}`);
      return;
    }
    lastErrorReply.set(jid, now);
  } else {
    bumpCounter("answered").then(v => v);
  }
  await sendMsg(sock, jid, reply);
}

async function routeText(sock, msg, jid, text, asVoice = false) {
  const fam = isFamily(jid, msg);
  const intimate = isIntimate(jid, msg);
  const sibling = isSibling(jid, msg);
  const boss = isBoss(jid, msg);
  const trainer = isTrainer(jid, msg);
  const special = fam || intimate || boss || trainer || sibling;
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
    else if (sibling) {
      const sname = siblingName(jid, msg);
      g = sname ? `هلا والله ${sname} 🌹` : SIBLINGS_GREETING_VARIANTS[Math.floor(Math.random() * SIBLINGS_GREETING_VARIANTS.length)];
    }
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
    else if (sibling) await respond(SIBLINGS_FAREWELLS[Math.floor(Math.random() * SIBLINGS_FAREWELLS.length)]);
    else if (fam) await respond(FAMILY_FAREWELLS[Math.floor(Math.random() * FAMILY_FAREWELLS.length)]);
    else await respond(GOODBYES[Math.floor(Math.random() * GOODBYES.length)]);
    return true;
  }
  if (isThanks(t)) {
    await respond(FAREWELLS[Math.floor(Math.random() * FAREWELLS.length)]);
    return true;
  }
  // كلمة إنهاء حديث من طالب: ماشي/تمام/ان شاء الله/مع السلامة... رد وداع وخلاص، بدون ترجيع سؤال
  if (!fam && !intimate && !boss && !trainer && !sibling && jid !== ownerJid && isEndChat(text)) {
    await respond(GOODBYES[Math.floor(Math.random() * GOODBYES.length)]);
    return true;
  }
  // تحية الطالب العادي: باسمه إذا معروف + حسب الوقت، وإذا حكى شي تاني مع التحية منجاوب على سؤاله مباشرة
  if (isGreeting(t)) {
    const rest = text.replace(GREETING_PATTERN, "").replace(/^[\s،,!.\-ـ]+/, "").trim();
    const restWords = rest.split(/\s+/).filter(Boolean);
    const questionish = /(رخصه|رخصة|درس|سعر|تيست|موعد|امتحان|فحص|اوراق|أوراق|معامله|معاملة|مطلوب|كم|وين|شو|مين|ليش|كيف|بكم)/i.test(rest);
    const bare = rest.length < 3 || isGreeting(rest) || (!questionish && restWords.length <= 3);
    if (bare) {
      const nm = studentName(jid, msg);
      const tg = timeGreeting();
      const pick = STUDENT_GREETING_VARIANTS[Math.floor(Math.random() * STUDENT_GREETING_VARIANTS.length)];
      await respond(pick.replace(/{name}/g, nm ? `يا ${nm}` : "").replace(/{tg}/g, tg).replace(/\s{2,}/g, " ").trim());
      return true;
    }
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
  const storeReply = await findStoreReply(text, t);
  if (storeReply) {
    bumpCounter("answered").then(v => v);
    await respond(storeReply.reply);
    return true;
  }
  const faq = handleFAQ(text, t, getTypeForChat(jid), jid);
  if (faq) {
    await respond(faq);
    return true;
  }
  return false;
}

function handleFAQ(raw, norm, defType, jid) {
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
    تراكتور: "لرخصة التراكتور بتلزمك صورتين شخصية بخلفية زرقاء وصورة هوية، والفحص الطبي بدون صيام. تعال على المدرسة ببيطا شارع السلام ومنعملك المعاملة.",
    خصوصي: "لرخصة الخصوصي بتلزمك صورتين شخصية بخلفية زرقاء وصورة هوية. تعال على المدرسة ببيطا شارع السلام ومنعملك المعاملة، وبعدها فحص طبي بدون صيام وتقدم توريا.",
    "شحن خفيف": "لرخصة الشحن الخفيف بتلزمك 4 صور شخصية بخلفية زرقاء وصورتين هوية. تعال على المدرسة ببيطا شارع السلام ومنعملك المعاملة، وبعدها فحص طبي بصيام.",
    "شحن ثقيل": "لرخصة الشحن الثقيل بتلزمك 4 صور زرقاء وصورتي هوية وصورة رخصة وشهادة خامس فأعلى. تعال على المدرسة ببيطا شارع السلام ومنعملك المعاملة، وبعدها فحص طبي بصيام.",
    باص: "لرخصة الباص بتلزمك 4 صور زرقاء وصورتي هوية وصورة رخصة وشهادة فوق الثامن مصدقة وحسن سير. تعال على المدرسة ببيطا شارع السلام ومنعملك المعاملة.",
    اسعاف: "رخصة الإسعاف: العمر 21 سنة، وتجي عالمدرسة ببيطا ومنعملك المعاملة.",
  };
  const findType = (priority) => {
    const list = priority || ["شحن ثقيل", "شحن خفيف", "تراكتور", "خصوصي", "باص", "اسعاف", "شحن", "ثقيل"];
    for (const k of list) if (has(k)) return k;
    return null;
  };
  if (has("استلام", "استلم", "استختار", "استخراج", "شيل الرخصه", "شيل الرخصة", "استلم رخصتي", "استلام رخصتي", "استلام الرخصة", "استلام الرخصه", "بشيل الرخصه", "بشيل الرخصة", "سائق جديد")) {
    if (has("تجديد") || has("5 سنوات") || has("خمس سنوات") || has("5 سنين") || has("خمس سنين")) return "التجديد بيدفع 202 شيكل والمدة 5 سنوات. هاد رسوم دائرة السير والدفع عندها ببطاقة فيزا.";
    return "استلام الرخصة أول مرة بيدفع 82 شيكل لمدة سنتين وبتصير سائق جديد، وبعدها التجديد 5 سنوات بيدفع 202 شيكل. هاد كلو رسوم دائرة السير والدفع عندها بس ببطاقة فيزا، وأجور المدرسة نقدي.";
  }
  if (has("مبروك", "مبارك", "الف مبروك", "ألف مبروك", "مبارك عليك")) return "الله يبارك فيك، منورتنا 🌹";
  if ((hasWord("موعد", "ميعاد", "وقت", "الوقت", "التوقيت", "ساعة", "ساعه", "الساعة", "الساعه", "عشرة", "عشره") && hasWord("درس", "دروس", "درسي", "درسه", "تدريب", "التدريب", "بتمرن", "تعليم", "حصة", "حصه", "الحصة", "الحصه")) || has("موعد الدرس", "وقت الدرس", "موعد التدريب", "ساعة الدرس", "ساعة التدريب", "موعد درسي", "وقت درسي")) {
    return "بخصوص موعد الدرس، تواصل مع الاستاذ سمير وقت متأخر وبيحدد لك موعد الدرس بالتفصيل.";
  }
  if (has("بدي طلع رخصه", "بدي طلع رخصة", "بدي اطلع رخصه", "بدي اطلع رخصة", "بدي اخذ رخصه", "بدي اخذ رخصة")) {
    if (defType && FULL[defType]) { setTypeForChat(jid, defType); return FULL[defType]; }
    return "احكيلي نوع الرخصة (خصوصي، شحن خفيف، شحن ثقيل، باص، تراكتور) وبعطيك كل التفاصيل.";
  }
  if (has("عمر", "سن", "كم عمر", "السن")) {
    if (has("تراكتور")) { setTypeForChat(jid, "تراكتور"); return "تراكتور: عمرك 16 سنة."; }
    if (has("شحن ثقيل") || has("ثقيل")) { setTypeForChat(jid, "شحن ثقيل"); return "شحن ثقيل: عمرك 19 سنة."; }
    if (has("شحن خفيف") || has("شحن")) { setTypeForChat(jid, "شحن خفيف"); return "شحن خفيف: عمرك 18 سنة، ومن عمر 17.5 بتقدر تبدأ إجراءات، وبعد النجاح بتستلم رخصة خصوصي أول، وبس تصير 18 بتستلم رخصة الشحن."; }
    if (has("خصوصي")) { setTypeForChat(jid, "خصوصي"); return "خصوصي: عمرك 17.5 سنة (بعمر 17 بيجهز معاملة ويقدم توريا أو تيست)."; }
    if (has("باص")) { setTypeForChat(jid, "باص"); return "باص: عمرك 20 سنة، وشرطها شحن خفيف سنتين مع شهادة فوق الثامن مصدقة وحسن سير."; }
    return "الأعمار: تراكتور 16، خصوصي 17.5، شحن خفيف 18، ثقيل 19، باص 20، إسعاف 21.";
  }
  if (has("فحص طبي", "الفحص", "فحص ") || has("تأمين", "طبي")) {
    const askPrice = has("شيكل", "بشيكل", "سعر", "السعر", "السعر", "تكلفة", "بكلف", "بتكلف", "كم", "بش");
    if (askPrice) {
      if (has("شحن", "باص")) return "الفحص الطبي شحن/باص 240 شيكل ومع صيام.";
      if (has("خصوصي", "تراكتور")) return "الفحص الطبي خصوصي/تراكتور 120 شيكل وبدون صيام.";
      return "الفحص الطبي على حسب نوع الرخصه: خصوصي/تراكتور 120 بدون صيام، شحن/باص 240 بصيام.";
    }
    return "الفحص الطبي بيوم الأحد 8 الصبح بمديرية الصحة بواد البقيع.";
  }
  if (has("مطلوب", "شو المطلوب", "الاشياء", "شو الاشياء", "الأشياء", "بتلزم", "يلزم", "بلزم", "الاوراق", "الأوراق", "صور", "معاملة", "معامله", "اجراءات", "إجراءات", "لوازم", "اجهز", "أجهز")) {
    if (has("شحن ثقيل") || has("ثقيل")) { setTypeForChat(jid, "شحن ثقيل"); return "أوراق الشحن الثقيل: 4 صور زرقاء + صورتين هوية + صورة رخصة + شهادة خامس فأعلى. تعال على المدرسة ببيطا شارع السلام ومنعملك المعاملة."; }
    if (has("شحن خفيف") || has("شحن")) { setTypeForChat(jid, "شحن خفيف"); return "أوراق الشحن الخفيف: 4 صور شخصية بخلفية زرقاء + صورتين هوية. تعال على المدرسة ببيطا شارع السلام ومنعملك المعاملة، وبعدها فحص طبي بصيام."; }
    if (has("باص")) { setTypeForChat(jid, "باص"); return "أوراق الباص: 4 صور زرقاء + صورتين هوية + صورة رخصة + شهادة فوق الثامن مصدقة + حسن سير. تعال على المدرسة ببيطا شارع السلام ومنعملك المعاملة."; }
    if (has("تراكتور")) { setTypeForChat(jid, "تراكتور"); return "أوراق التراكتور: صورتين بخلفية زرقاء + صورة هوية. تعال على المدرسة ببيطا شارع السلام ومنعملك المعاملة."; }
    if (has("خصوصي")) { setTypeForChat(jid, "خصوصي"); return "أوراق الخصوصي: صورتين شخصية بخلفية زرقاء + صورة هوية. تعال على المدرسة ببيطا شارع السلام ومنعملك المعاملة."; }
    if (defType && FULL[defType]) { setTypeForChat(jid, defType); return FULL[defType]; }
    return "الأوراق على حسب نوع الرخصة، شو نوعها؟ (خصوصي، شحن خفيف، شحن ثقيل، باص، تراكتور)";
  }
  if (has("وين اعمل", "وين أعمل", "وين اجهز", "وين أجهز", "بجهز الاوراق", "بجهز الأوراق", "اعمل المعاملة", "اعمل المعامله", "جهز المعاملة", "جهز المعامله")) return "المعاملة بتجهز عنا بالمدرسة ببيطا، شارع السلام، بجانب سوبرماركت البديع. تعال ومنعملك ياها.";
  if (has("عنوان", "وين المدرسة", "موقع المدرسة", "وين المدرسه", "موقع المدرسه", "اين المدرسة", "بيطا")) return "المدرسة بيطا، شارع السلام، بين مثلث سليط وصرح الشهيد، بجانب سوبرماركت البديع.";
  if ((hasWord("درس", "الدرس", "دروس", "الدروس", "درسي") || hasWord("حصة", "حصه", "الحصة", "الحصه")) && !hasWord("المدرسه", "المدرسة", "مدرب", "المدرب", "المدربين")) {
    // ليش 15 درس؟ → قانون. وكم درس لازم
    if ((has("ليش") && has("15", "خمستاشر", "خمسطاشر", "خمسة عشر", "خمسه عشر")) || has("كم درس لازم", "عدد الدروس", "عادش درس", "عادش حصة", "كم حصة لازم")) {
      return "هاي القانون: 15 درس عملي إجبارية لكل طالب قبل التيست.";
    }
    // انا بعرف اسوق / مش بحاجة دروس
    if (has("انا بعرف اسوق", "بعرف اسوق", "انا بسوق", "بسوق منيح", "مش بحاجة دروس", "ما بحاجة دروس", "ما بدني دروس", "ما بدي دروس")) {
      return "ماشي، بس لازم تطلع معك الأستاذ سمير، هو بيقيم وضعك وبحددلك عدد الدروس اللي بتحتاجها.";
    }
    if (has("خصوصي")) { setTypeForChat(jid, "خصوصي"); return "درس خصوصي: 105 شيكل."; }
    if (has("شحن ثقيل") || has("ثقيل")) { setTypeForChat(jid, "شحن ثقيل"); return "درس ثقيل: 180 شيكل."; }
    if (has("شحن خفيف") || has("شحن")) { setTypeForChat(jid, "شحن خفيف"); return "درس شحن خفيف: 125 شيكل."; }
    if (has("باص")) { setTypeForChat(jid, "باص"); return "درس باص: 180 شيكل."; }
    if (has("تراكتور")) { setTypeForChat(jid, "تراكتور"); return "درس تراكتور: 105 شيكل."; }
    if (defType && LESSON_PRICE[defType] != null) return `درس ${defType}: ${LESSON_PRICE[defType]} شيكل.`;
    return "أسعار الدرس: خصوصي 105، شحن خفيف 125، ثقيل 180، باص 180، تراكتور 105.";
  }
  if (has("تيست", "التيست", "فحص نتيج")) {
    if (has("نظري") || has("توريا")) return "رابط نتيجة التوريا: https://www.mot.gov.ps/theoretical-exam";
    if (has("عملي")) return "رابط نتيجة العملي: https://www.mot.gov.ps/practical-exam";
    if (has("خصوصي")) { setTypeForChat(jid, "خصوصي"); return "تيست خصوصي أول: 320 شيكل."; }
    if (has("شحن ثقيل") || has("ثقيل")) { setTypeForChat(jid, "شحن ثقيل"); return "تيست ثقيل أول: 520 شيكل."; }
    if (has("شحن خفيف") || has("شحن")) { setTypeForChat(jid, "شحن خفيف"); return "تيست شحن خفيف: أول 380، تاني وما فوق 460."; }
    if (has("باص")) { setTypeForChat(jid, "باص"); return "تيست باص أول: 520 شيكل."; }
    if (has("تراكتور")) { setTypeForChat(jid, "تراكتور"); return "تيست تراكتور أول: 320 شيكل."; }
    if (defType && TEST_PRICE[defType] != null) return `تيست ${defType} أول: ${TEST_PRICE[defType]} شيكل.`;
    return "رسوم التيست أول: خصوصي 320، شحن خفيف 380، ثقيل 520، باص 520، تراكتور 320.";
  }
  // مدة إنجاز الرخصة
  if ((hasWord("مدة", "مده", "وقت", "بتاخد", "بتاخذ", "تاخد", "تاخذ") && hasWord("رخصه", "رخصة", "دروس", "تعليم", "معاملة", "معامله")) || has("كم بدها وقت", "كم وقت", "قداش وقت", "كم شهر", "بتاخد اشي")) {
    return "تقريباً من شهر لشهرين إذا كنت منتظم: المعاملة والفحص الطبي بيومين تلاتة أيام، وبعدين 15 درس عملي، وبعدها التيست والنظري. المنتظم بالدروس بتخلص أسرع.";
  }
  if (has("تكلفة رخصة", "كم تكلفة", "كم بتكلف", "بشيكل", "التكلفة", "التكلفه", "كم بكلف", "كم السعر", "كم بيكلف", "كلفت", "طريقه دفع", "طريقة الدفع", "كيف ادفع", "كيف أدفع", "الدفع", "تكلف", "مصاري", "مصاريف", "بكام", "شو سعر", "السعر", "سعرها")) {
    if (has("شحن خفيف") || has("شحن")) { setTypeForChat(jid, "شحن خفيف"); return "تكلفة الشحن الخفيف بشكل عام تقريباً 2255 شيكل: الدرس 125 × 15 درس + تيست أول 380. والدفع عنا بالمدرسة نقدي، والفيزا بس لرسوم دائرة السير. ولما يتواصل معك الأستاذ سمير حياك الله 🌹"; }
    if (has("شحن ثقيل") || has("ثقيل")) { setTypeForChat(jid, "شحن ثقيل"); return "تكلفة الشحن الثقيل بشكل عام تقريباً 3220 شيكل: الدرس 180 × 15 درس + تيست أول 520. والدفع عنا بالمدرسة نقدي، والفيزا بس لرسوم دائرة السير. ولما يتواصل معك الأستاذ سمير حياك الله 🌹"; }
    if (has("خصوصي")) { setTypeForChat(jid, "خصوصي"); return "تكلفة الخصوصي بشكل عام تقريباً 1895 شيكل: الدرس 105 × 15 درس + تيست أول 320. والدفع عنا بالمدرسة نقدي، والفيزا بس لرسوم دائرة السير. ولما يتواصل معك الأستاذ سمير حياك الله 🌹"; }
    if (has("باص")) { setTypeForChat(jid, "باص"); return "تكلفة الباص بشكل عام تقريباً 3220 شيكل: الدرس 180 × 15 درس + تيست أول 520. والدفع عنا بالمدرسة نقدي، والفيزا بس لرسوم دائرة السير. ولما يتواصل معك الأستاذ سمير حياك الله 🌹"; }
    if (has("تراكتور")) { setTypeForChat(jid, "تراكتور"); return "تكلفة التراكتور بشكل عام تقريباً 1895 شيكل: الدرس 105 × 15 درس + تيست أول 320. والدفع عنا بالمدرسة نقدي، والفيزا بس لرسوم دائرة السير. ولما يتواصل معك الأستاذ سمير حياك الله 🌹"; }
    if (defType && LESSON_PRICE[defType] != null && TEST_PRICE[defType] != null) {
      const lp = LESSON_PRICE[defType], tp = TEST_PRICE[defType];
      return `تكلفة ${defType} بشكل عام تقريباً ${lp * 15 + tp} شيكل: الدرس ${lp} × 15 درس + تيست أول ${tp}. والدفع عنا بالمدرسة نقدي، والفيزا بس لرسوم دائرة السير. ولما يتواصل معك الأستاذ سمير حياك الله 🌹`;
    }
    return "التكلفة بتعتمد على نوع الرخصة، شو نوعها؟ (خصوصي، شحن خفيف، ثقيل، باص، تراكتور)";
  }
  if (has("الامتحان النظري", "التوريا") && (has("وين", "مكان", "دائرة", "أين"))) return "الامتحان النظري (التوريا) بدائرة السير بمنطقة عزيز، على طريق المستشفى.";
  if (has("دوسية", "الدوسية", "دوسيه", "الدوسيه", "رابط", "لينك", "شو ادرس", "بدي ادرس", "بدني ادرس", "وين ادرس", "ازا اذاكر", "كيف اذاكر", "شو اذاكر", "بدي ذاكر", "اذاكر", "مذاكرة", "المذاكرة", "المذاكره") || ((has("ادرس", "اقرا", "أدرس", "دراسة", "الدراسة", "روابط", "الروابط", "ابحث", "اتعلم")) && !hasWord("مدرب", "المدربين"))) {
    if (has("عملي")) return "رابط نتيجة العملي: https://www.mot.gov.ps/practical-exam";
    return "للمذاكرة للتوريا، بادرس من الرابط هاد: https://nbn40n-cpu.github.io/samir-teoria.github.io/ وبتشوف نتيجة الامتحان النظري على: https://www.mot.gov.ps/theoretical-exam";
  }
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
  if (has("مقاولة", "مقاوله")) return "رخصة المقاولة: بتنجح التوريا أول، وبعدها بنحدد ونشوف حسب وضعك وحسب شطارتك.";
  if (has("دورة باص", "دوره باص", "دورة الباص", "كورس باص")) return "دورة الباص: مدتها 3 شهور، 3 أيام بالأسبوع من 2:30 لـ5 العصر، وسعرها 1750 شيكل.";
  if (has("بدي اطلع", "اريد اطلع", "عايز اطلع", "عاوز اطلع", "بدي اخذ", "اريد اخذ", "بدي رخصة", "اريد رخصة", "عايز رخصة", "استفسر", "بستفسر", "بتأكد", "رخصة") && has("رخصة")) {
    const ty = findType(["شحن ثقيل", "شحن خفيف", "تراكتور", "خصوصي", "باص", "اسعاف"]);
    const tyBare = has("شحن") && !has("شحن ثقيل", "شحن خفيف") ? "شحن خفيف" : null;
    let chosen = (ty && FULL[ty]) ? ty : (tyBare && FULL[tyBare] ? tyBare : null);
    if ((!chosen || !FULL[chosen]) && defType && FULL[defType]) chosen = defType;
    if (chosen && FULL[chosen]) { setTypeForChat(jid, chosen); return FULL[chosen]; }
    return "احكيلي نوع الرخصة (خصوصي، شحن خفيف، شحن ثقيل، باص، تراكتور) وبعطيك كل التفاصيل.";
  }
  if (hasWord("اوتوماتيك", "اوتماتيك", "اوتوماتك", "اتوماتيك", "عادي") && !has("شحن", "ثقيل", "تيست")) { setTypeForChat(jid, "خصوصي"); return FULL["خصوصي"] || "خصوصي"; }
  if (raw.trim().split(/\s+/).length <= 4) {
    const ty = findType(["شحن ثقيل", "شحن خفيف", "تراكتور", "خصوصي", "باص", "اسعاف"]);
    const tyBare = has("شحن") && !has("شحن ثقيل", "شحن خفيف") ? "شحن خفيف" : null;
    let chosen = (ty && FULL[ty]) ? ty : (tyBare && FULL[tyBare] ? tyBare : null);
    if ((!chosen || !FULL[chosen]) && defType && FULL[defType] && hasWord("رخصه", "رخصة")) chosen = defType;
    if (chosen && FULL[chosen]) { setTypeForChat(jid, chosen); return FULL[chosen]; }
  }
  return null;
}

async function applyStoreNumbers() {
  try {
    const s = await loadStore();
    if (!s || !s.numbers) return;
    if (Array.isArray(s.numbers.family) && s.numbers.family.length) FAMILY_NUMBERS = [...s.numbers.family];
    if (Array.isArray(s.numbers.intimate) && s.numbers.intimate.length) INTIMATE_NUMBERS = [...s.numbers.intimate];
    if (Array.isArray(s.relatives) && s.relatives.length) {
      SIBLINGS_NUMBERS = [];
      SIBLINGS_NAMES = {};
      RELATIVE_INFO.clear();
      for (const r of s.relatives) {
        if (!r || !r.phone || r.active === false) continue;
        const ph = String(r.phone).replace(/\D/g, "");
        if (!ph) continue;
        SIBLINGS_NUMBERS.push(ph);
        if (r.name) SIBLINGS_NAMES[ph] = r.name;
        RELATIVE_INFO.set(ph, { name: r.name || "", relation: r.relation || "", notes: r.notes || "", styleNote: r.styleNote || "" });
      }
    } else {
      if (Array.isArray(s.numbers.siblings)) SIBLINGS_NUMBERS = [...s.numbers.siblings];
      if (s.names?.siblings) SIBLINGS_NAMES = { ...s.names.siblings };
    }
    if (Array.isArray(s.numbers.boss) && s.numbers.boss.length) BOSS_NUMBERS = [...s.numbers.boss];
    if (Array.isArray(s.numbers.trainers) && s.numbers.trainers.length) TRAINER_NUMBERS = [...s.numbers.trainers];
    if (s.names?.family) FAMILY_NAMES = { ...s.names.family };
    if (s.names?.trainers) TRAINER_NAMES = { ...s.names.trainers };
    if (s.studentNames && typeof s.studentNames === "object") Object.assign(STUDENT_NAMES, s.studentNames);
  } catch (e) {
    console.error("⚠️ store numbers load failed (using defaults):", e.message);
  }
}

let panelStarted = false;
async function start() {
  status.startedAt = Date.now();
  await applyStoreNumbers();
  await setLastStart();
  if (!panelStarted) {
    panelStarted = true;
    await startPanel({
      getBotState: () => ({
        botState: getControl().paused ? "متوقف مؤقتاً" : "شغال",
        whatsapp: status.state,
        needsLink: status.state === "starting" || status.state === "closed",
        state: status.state,
        user: status.user || "",
        paused: getControl().paused,
        pairingCode: status.code || "",
        uptimeSeconds: Math.round((Date.now() - (status.startedAt || Date.now())) / 1000),
      }),
      onConfigChanged: async () => {
        await applyStoreNumbers();
      },
      onNumbersChanged: async () => {
        await applyStoreNumbers();
      },
      onControl: async (action) => {
        if (action === "pause") {
          setPaused(true);
          return { paused: true };
        }
        if (action === "resume") {
          setPaused(false);
          return { paused: false };
        }
        if (action === "restart") {
        console.log("🔄 إعادة تشغيل من لوحة التحكم");
        setTimeout(() => process.exit(0), 500);
        return { restarting: true };
      }
      if (action === "relink") {
        status.state = "relinking";
        console.log("🔁 طلب إعادة ربط واتساب من لوحة التحكم");
        try { fs.rmSync(authPath, { recursive: true, force: true }); console.log("🗑️ تم حذف جلسة واتساب القديمة"); } catch (_) {}
        setTimeout(() => process.exit(0), 300);
        return { relinking: true };
      }
      throw new Error("إجراء غير معروف: " + action);
    },
  });
  }

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
  for (const n of [...FAMILY_NUMBERS, ...INTIMATE_NUMBERS, ...SIBLINGS_NUMBERS, ...BOSS_NUMBERS, ...TRAINER_NUMBERS]) {
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
      setLastError(`قطع اتصال واتساب (${reason})`);
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
        const sid = m.key?.id || "";
        if (sid && !mySentIds.has(sid) && !seen.has("own_" + sid)) {
          seen.add("own_" + sid);
          const otext = extractText(m);
          const notSpecial = !isFamily(jid, m) && !isIntimate(jid, m) && !isSibling(jid, m) && !isBoss(jid, m) && !isTrainer(jid, m);
          if (otext && otext.length >= 3 && otext.length <= 500 && !isEmojiOnly(otext) && jid !== ownerJid && notSpecial) {
            captureOwnerReply(jid, m, otext).catch(() => {});
          }
        }
        continue;
      }

      const lastOwner = ownerActive.get(jid) || 0;
      if (Date.now() - lastOwner < OWNER_PAUSE_MS) {
        console.log(`🔕 صمت - المالك عم يرد في ${jid} خلال 10 دقايق، تأجيل الرد`);
        continue;
      }

      if (getControl().paused) {
        if (!m.key?.fromMe) {
          try { await sock.sendMessage(jid, { text: "معذرة، البوت متوقف مؤقتاً من لوحة التحكم، رح يرجع عن قريب. ✋" }); } catch (_) {}
        }
        continue;
      }

      console.log(`📩 ${jid} (${pnOf(jid, m)}): ${extractText(m).slice(0, 60) || "[media]"}`);
      const qtext = extractText(m);
      if (qtext && qtext.length >= 2) lastStudentQ.set(jid, { q: qtext.slice(0, 300), ts: Date.now() });
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