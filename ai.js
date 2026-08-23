import Groq from "groq-sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { getSchoolInfo, getStyles, getLearningBlock } from "./school-context.js";
import { getStore } from "./store.js";

const execFileAsync = promisify(execFile);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function aiSettings() {
  const s = await getStore();
  return {
    primary: s.ai?.primaryModel || "groq/compound",
    fallbacks: Array.isArray(s.ai?.fallbackModels) && s.ai.fallbackModels.length ? s.ai.fallbackModels : ["qwen/qwen3.6-27b", "groq/compound-mini"],
    temperature: typeof s.ai?.temperature === "number" ? s.ai.temperature : 0.7,
    maxTokens: typeof s.ai?.maxTokens === "number" ? s.ai.maxTokens : 200,
    factTemperature: 0.4,
    factMaxTokens: 250,
    voice: s.voice?.voice || "ar-JO-SanaNeural",
    rate: s.voice?.rate || "-8%",
    pitch: s.voice?.pitch || "-1Hz",
    groqVoice: s.voice?.groqVoice || "lulwa",
    provider: s.voice?.provider || "groq",
    gain: s.voice?.gain != null ? String(s.voice.gain) : "1.5",
  };
}

async function getModels() {
  const c = await aiSettings();
  return [c.primary, ...c.fallbacks.filter((m) => m !== c.primary)];
}

async function runEdgeTTS(args) {
  const pythons = ["python3", "python"];
  let lastErr = null;
  for (const py of pythons) {
    try {
      const { stdout, stderr } = await execFileAsync(py, ["-m", "edge_tts", ...args], { timeout: 60000 });
      return { stdout, stderr };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export const ERROR_REPLY = "هلا، فيه مشكلة مؤقتة، جرب تراسل تاني بعد شوي أو اكتب مدير سمير.";
const chatMemory = new Map();
const MEMORY_LIMIT = 4;
const CONFUSED_REPLY = "هههه آسفة، ما فهمتك، عيدها بكلمات ثانية؟";

const NO_THINKING = `

مهم جداً: أجبي فقط بالنص النهائي لردك على واتساب بالعامية الأردنية، جملة أو جملتين. لا تكتبي أي قسم thinking أو تحليل أو أفكار داخلية أو تعليمات أو تكرار لكلام المستخدم، ولا تبدئي بكلمة User أو المستخدم أو Context.
- جاوب بس عاللي سأل عنه، قصير مباشر بدون مقدمات ولا أسئلة مرتدة.
- ممنوع تعيد كلام الطالب أو تناديه بلقب حكى عنه؛ حيّي عام أو باسمه إذا معروف.
- إذا قال ماشي/تمام/ان شاء الله/مع السلامة: ودّع وخلاص بدون ترجيع.

`;

export function cleanReply(reply) {
  let s = (reply || "").trim();
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, " ");
  const openThink = s.search(/<think>/i);
  if (openThink !== -1) s = s.slice(0, openThink);
  const ti = s.search(/thinking/i);
  if (ti !== -1) {
    const after = s.slice(ti + 8);
    const ai = after.search(/[Aa]nswer\s*:/i);
    if (ai !== -1) s = after.slice(ai + 7);
    else s = after;
  }
  const leak = /(User says:|Analyze User Input:|Analyze (the|this|user|input)|The user asks|Context:|Previous messages|Key info needed|Key information|Key elements|Keep it short|Rule for|\bRule:|Rules?:|Matches the rule|System:|Assistant:|مهم جداً|سؤال المستخدم|المستخدم قال|Context: Previous|The intent|The user is (frustrated|confused|asking|clarifying)|I'll help|outside the core scope|prompt says|As an AI|I am an AI|I am "|I'm "سوزي|I am "سوزي)/i;
  const arLetter = /[\u0621-\u064A\u0671-\u06D3]/g;
  const lines = (s || "").split(/\n+/)
    .map(l => l.replace(/^\s*[-•*\d.)]\s*/, "").trim())
    .filter(l => {
      if (!l || leak.test(l)) return false;
      const ars = (l.match(arLetter) || []).length;
      const letters = (l.match(/[A-Za-z\u0621-\u064A\u0671-\u06D3]/g) || []).length;
      if (letters > 4 && ars / letters < 0.45) return false;
      return /[\u0621-\u064A\u0671-\u06D3]/.test(l);
    });
  let text = lines.join(" ") || "";
  text = text.replace(/^#{1,4}\s*/, "").replace(/\*\*/g, "").replace(/\s{2,}/g, " ").trim();
  if (leak.test(text)) return "";
  return text;
}

export async function getAIResponse(userMessage, isFamily = false, isIntimate = false, isBoss = false, isTrainer = false, isOwner = false, chatId = "") {
  const [schoolInfo, styles, learnBlock] = await Promise.all([getSchoolInfo(), getStyles(), isOwner ? Promise.resolve("") : getLearningBlock()]);
  const system = (isOwner ? schoolInfo + styles.owner : isBoss ? schoolInfo + styles.boss : isTrainer ? schoolInfo + styles.trainer : isIntimate ? schoolInfo + styles.intimate : isFamily ? schoolInfo + styles.family : schoolInfo + (learnBlock || "")) + NO_THINKING;
  const history = (chatMemory.get(chatId) || []).slice(-MEMORY_LIMIT);
  const settings = await aiSettings();
  const models = await getModels();
  let lastError = null;
  let gotEmpty = false;
  const ask = (model) => groq.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      ...history,
      { role: "user", content: userMessage },
    ],
    temperature: settings.temperature,
    max_tokens: /qwen/i.test(model) ? Math.max(settings.maxTokens, 2000) : settings.maxTokens,
  });
  const isDailyLimit = (e) => /per day|\(RPD\)/i.test(e?.error?.message || e?.message || "");
  for (const model of models) {
    try {
      const completion = await ask(model);
      const reply = cleanReply(completion.choices[0]?.message?.content || "");
      if (!reply) { gotEmpty = true; console.error(`⚠️ ${model} رد فارغ/منفلتر — ننتقل للموديل التالي`); continue; }
      chatMemory.set(chatId, [...history, { role: "user", content: userMessage }, { role: "assistant", content: reply }].slice(-MEMORY_LIMIT));
      return reply;
    } catch (error) {
      lastError = error;
      if (isDailyLimit(error)) {
        console.error(`⚠️ ${model} خلص حده اليومي — ننتقل للموديل التالي`);
        continue;
      }
      if (error?.status === 429 && model === settings.primary) {
        let retried = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          console.error(`⚠️ ${model} معدل محدود — ننتظر ${(attempt + 1) * 2} ثواني ونعيد المحاولة`);
          await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
          try {
            const retry = await ask(model);
            const reply = cleanReply(retry.choices[0]?.message?.content || "");
            if (!reply) { gotEmpty = true; break; }
            chatMemory.set(chatId, [...history, { role: "user", content: userMessage }, { role: "assistant", content: reply }].slice(-MEMORY_LIMIT));
            return reply;
          } catch (retryErr) {
            lastError = retryErr;
            console.error(`⚠️ ${model} محاولة ${attempt + 1} فشلت`);
            retried = true;
          }
        }
        if (retried) console.error(`⚠️ ${model} لا يزال محدوداً — ننتقل للموديل التالي`);
      } else {
        console.error(`⚠️ ${model}: ${error.message} — ننتقل للموديل التالي`);
      }
      continue;
    }
  }
  console.error("AI Error:", lastError?.message);
  return gotEmpty ? CONFUSED_REPLY : ERROR_REPLY;
}

export async function getAIFactReply(fact, userMessage, isFamily = false, isIntimate = false, isBoss = false, isTrainer = false, chatId = "") {
  const [schoolInfo, styles] = await Promise.all([getSchoolInfo(), getStyles()]);
  const style = isBoss ? styles.boss : isTrainer ? styles.trainer : isIntimate ? styles.intimate : isFamily ? styles.family : "";
  const system = schoolInfo + style + `

مهم جداً: المستخدم سأل عن معلومة من المدرسة. المعلومة الصحيحة من سجلات المدرسة هي:
"""${fact}"""

رد على سؤال المستخدم بالعامية الأردنية بشكل طبيعي وإنساني تلقائي كشخص حقيقي، ليس كبوت ولا روبوت. عبّر عن المعلومة بكلماتك الطبيعية وكأنك سكرتيرة بتجاوب أحد على واتساب، لا تسقط كقائمة نقاط، ولا تحيّد عن المعلومة الصحيحة ولا تغيّر أي رقم منها، ولا تضف معلومات غير موجودة. ركّز على سؤال المستخدم الأخير فقط.`;
  const settings = await aiSettings();
  const models = await getModels();
  for (const model of models) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMessage },
        ],
        temperature: settings.factTemperature,
        max_tokens: settings.factMaxTokens,
      });
      const reply = completion.choices[0]?.message?.content || "";
      if (reply.trim()) return reply.trim();
    } catch (error) {
      if (error?.status === 429) { console.error(`⚠️ ${model} معدل محدود`); continue; }
      console.error("AI Fact Error:", error.message);
      return fact;
    }
  }
  return fact;
}

export async function transcribeAudio(audioBuffer, mimeType) {
  try {
    const blob = new Blob([audioBuffer], { type: mimeType });
    const file = new File([blob], "voice.ogg", { type: mimeType });
    const transcript = await groq.audio.transcriptions.create({
      file,
      model: "whisper-large-v3",
      language: "ar",
      response_format: "text",
      temperature: 0,
      prompt: "رسالة صوتية بالعامية الأردنية من طالب في مدرسة لتعليم السياقة عن: موعد الدرس، ساعة التدريب، سمير المدرب، رخصة خصوصي أو شحن، فحص طبي، تيست، توريا، دفع فيزا.",
    });
    return transcript || "";
  } catch (error) {
    console.error("Transcribe Error:", error.message);
    return "";
  }
}

const colloquialMap = {
  "أعتذر": "آسفة",
  "أعتذر عن": "آسفة على",
  "أرجو": "لو سمحت",
  "يرجى": "لو سمحت",
  "من فضلك": "لو سمحت",
  "سوف": "",
  "سأ": "رح",
  "ست": "رح",
  "عليك أن": "لازم",
  "عليك أنْ": "لازم",
  "يمكن": "بتقدر",
  "هل تود": "بدك",
  "هل تريد": "بدك",
  "تود": "بدك",
  "الرجاء": "لو سمحت",
  "السلام عليكم": "هلا",
  "أهلاً وسهلاً": "هلا",
  "لذلك": "يعني",
  "أيضاً": "كمان",
  "أيضا": "كمان",
  "حيث": "لأنه",
  "حالياً": "هلق",
  "حاليا": "هلق",
  "بشكل عام": "بشكل عام",
  "نحن في خدمتكم": "إحنا بالخدمة",
  "في خدمتكم": "بالخدمة",
  "سيتم": "رح",
  "سأقوم": "رح",
  "أنتم بحاجة": "بدكم",
  "المدرب سمير": "المدرب سمير",
  "مراسلة": "مراجعة",
  "وبعد ذلك": "وبعدين",
  "بعد ذلك": "بعدين",
  "ثم": "وبعدين",
  "قبل ذلك": "قبل هيك",
  "الآن": "هلق",
  "لاحقاً": "بعدين",
  "لاحقا": "بعدين",
  "غداً": "بكرة",
  "غدا": "بكرة",
  "غداَ": "بكرة",
  "فقط": "بس",
  "عندما": "لما",
  "إلى": "لـ",
  "عند": "عندي",
  "المدرسة": "المدرسة",
  "يرجى التفضل": "تفضل",
  "ممنوع من النشر": "ممنوع من النشر",
  "لا تتردد": "مش تتأخر",
  "لا تتردد في": "ما تخافش من",
  "بالنسبة": "بخصوص",
  "سألتك": "سألتك",
  "أنا هنا": "انا هون",
  "هنا": "هون",
  "هل يوجد": "في",
  "يوجد": "في",
  "توجد": "في",
  "نعم يوجد": "هلا في",
  "الموعد": "الميعاد",
  "موعد": "ميعاد",
  "بالطبع": "طبعاً",
  "بالتأكيد": "طبعاً",
  "عليكم": "عليكو",
  "أخبرني": "قللي",
  "أخبرك": "قللك",
  "أنت بحاجة": "بدك",
  "تحتاج": "بدك",
  "تحتاجون": "بدكم",
  "المتاح": "الموجود",
  "متاح": "موجود",
  "سأوفر": "رح زبط",
  "سأعطيك": "رح بعطيك",
  "رح أنتظر": "رح بنتظر",
  "سأنتظر": "رح بنتظر",
  "اسعاف": "اسعاف",
  "إسعاف": "اسعاف",
  "النصيحة": "النصيحة",
  "ممتاز": "ممتاز",
  "رقم الهاتف": "الرقم",
  "هاتف": "رقم",
  "الثلاثاء": "الثلاثا",
  "الاثنين": "الاثنين",
  "الخميس": "الخميس",
  "الأحد": "الاحد",
  "الجمعة": "الجمعة",
  "لا أ": "ما",
  "ذلك": "هيك",
  "هذا": "هذا",
  "هذه": "هذي",
  "لذا": "يعني",
  "ما زال": "لسا",
  "مازال": "لسا",
  "لا يزال": "لسا",
  "بعدما": "بعدين",
  "المكتب": "المكتب",
  "إليّ": "لي",
  "معهم": "معهم",
  "عنها": "عنها",
  "كيف حالك": "كيفك",
  "كيف الحال": "شو الاخبار",
  "ما المشكلة": "شو المشكلة",
  "على الفور": "فورا",
  "فوراً": "فورا",
  "قريباً جداً": "قريبا كتير",
  "في أقرب وقت": "بأقرب وقت",
  "أقصى سرعة": "أقرب وقت",
  "المديرية": "الدائرة",
  "وزارة": "الوزارة",
  "التوصيل": "التوصيل",
  "دورة": "دورة",
  "الدفع": "الدفع",
  "دفع": "دفع",
  "بطاقة": "بطاقة",
  "فيزا": "فيزا",
  "كاش": "كاش",
  "نقدي": "كاش",
  "استلام": "استلام",
  "شياء": "أشياء",
  "الشيا": "الأشياء",
  "الرجال": "الرجال",
  "سنوات": "سنين",
  "سنة": "سنة",
  "بضعة": "كم",
  "بعض": "شوي",
  "قليلاً": "شوي",
  "قليلا": "شوي",
  "جيداً": "منيح",
  "جيدا": "منيح",
  "حسناً": "زبط",
  "حسنا": "زبط",
  "تماماً": "بالظبط",
  "تماما": "بالظبط",
  "بالتحديد": "بالظبط",
  "السؤال": "السؤال",
  "سؤالك": "سؤالك",
  "أيضاً سؤال": "كمان سؤال",
  "مهم جداً": "مهم كتير",
  "جداً": "كتير",
  "جدا": "كتير",
  "الأخبار": "الاخبار",
  "كيفك أنت": "كيفك انت",
  "نحن": "إحنا",
  "أنه": "انو",
  "أنّ": "انو",
  "إنّ": "انو",
  "لأنه": "لأنه",
  "لكي": "عشان",
  "كي": "عشان",
  "من أجل": "عشان",
  "رغم": "مع انو",
  "على الرغم": "مع انو",
  "أعرف": "بعرف",
  "أعلم": "بعرف",
  "تعرف": "بتعرف",
  "نعرف": "بنعرف",
  "أفهم": "بفهم",
  "فهمت": "فهمت",
  "أقصد": "بقصد",
  "بدلا من": "بدل",
  "بدلاً من": "بدل",
  "اخترنا": "اخترنا",
  "أرجو المعذرة": "آسفة",
  "المعذرة": "آسفة",
  "معذرة": "آسفة",
  "نتمنى": "بتمنى",
  "أتوقع": "بتوقع",
  "سياقات": "سياقات",
  "ذاك": "هيك",
  "هؤلاء": "هذول",
  "جميع": "كل",
  "كافة": "كل",
  "أغلب": "أغلب",
  "نسبة": "نسبة",
  "الأمر": "الموضوع",
  "أمر": "شيء",
  "موضوع": "موضوع",
  "تحدث": "احكي",
  "تحدثت": "حكيت",
  "التحدث": "الحكي",
  "حديث": "الحكي",
  "رسالة": "رسالة",
  "الرسائل": "الرسائل",
  "ما عليك سوى": "كل اللي عليك",
  "سوى": "بس",
  "حسب": "حسب",
  "وفقاً": "حسب",
  "وفقا": "حسب",
  "استفسار": "سؤال",
  "الاستفسار": "السؤال",
  "أسئلة": "اسئلة",
  "رجاءً": "لو سمحت",
  "عليهما": "عليهم",
  "غالباً": "غالبا",
  "فعلياً": "فعليا",
  "بشكل جيد": "منيح",
  "الأسبوع الجاري": "هالاسبوع",
  "الأسبوع": "الاسبوع",
  "هذا الأسبوع": "هالاسبوع",
  "العام الجاري": "هالسنة",
  "السابق": "اللي فات",
  "المقبل": "الجاي",
  "القادم": "الجاي",
  "متى": "متى",
  "مغلق": "مقفول",
  "مفتوح": "مفتوح",
  "إغلاق": "قفل",
  "الإغلاق": "القفل",
  "عيد": "عيد",
  "بمناسبة": "بمناسبة",
  "تهانينا": "مبروك",
  "تهنئة": "مبروك",
  "عقبال": "عقبال",
  "الاتصال": "الاتصال",
  "اتصال": "اتصال",
  "الإنترنت": "النت",
  "أنترنت": "نت",
  "الموقع": "الرابط",
  "عبر": "عن",
  "فلاش": "فلاش",
  "إرسال": "بعت",
  "أرسل": "ابعث",
  "أرسلت": "بعت",
  "أرسلتُ": "بعت",
  "الرجاء الإرسال": "لو سمحت ابعت",
  "سؤال عن": "سؤال عن",
  "طلب": "طلب",
  "طلبات": "طلبات",
  "تفاصيل": "التفاصيل",
  "التفاصيل": "التفاصيل",
  "المعلومات": "المعلومات",
  "معلومات": "معلومات",
};

export function toColloquial(t) {
  let s = (t || "").trim();
  const entries = Object.entries(colloquialMap).filter(([k]) => k && k.trim());
  entries.sort((a, b) => b[0].length - a[0].length);
  const arLetter = /[\u0621-\u064A\u0671-\u06D3]/;
  for (const [k, v] of entries) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("(^|[^\\u0621-\\u064A\\u0671-\\u06D3])(" + escaped + ")([^\\u0621-\\u064A\\u0671-\\u06D3]|$)", "g");
    const hasNonLetter = /[\u0621-\u064A\u0671-\u06D3]/.test(k) && !/^[\u0621-\u064A\u0671-\u06D3\u0620\s]+$/.test(k);
    s = s.replace(re, (m, pre, word, post) => pre + v + post);
  }
  return s.replace(/\s{2,}/g, " ").replace(/[ \t]+([.,!?؛؟"])/g, "$1").trim();
}

const GROQ_TTS_URL = "https://api.groq.com/openai/v1/audio/speech";
const GROQ_TTS_MODEL = "canopylabs/orpheus-arabic-saudi";
const GROQ_TTS_MAX = 195;

function splitTTSChunks(t) {
  const s = (t || "").trim();
  if (!s) return [];
  if (s.length <= GROQ_TTS_MAX) return [s];
  const chunks = [];
  let rest = s;
  while (rest.length > GROQ_TTS_MAX) {
    let cut = rest.lastIndexOf(" ", GROQ_TTS_MAX);
    if (cut < GROQ_TTS_MAX / 2) cut = GROQ_TTS_MAX;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function groqSpeak(chunk, voice) {
  const res = await fetch(GROQ_TTS_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: GROQ_TTS_MODEL, input: chunk, voice: voice || "lulwa", response_format: "wav" }),
  });
  if (!res.ok) throw new Error(`Groq TTS HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function textToSpeech(text) {
  const tmpDir = process.env.TMPDIR || "/tmp";
  const uniq = `${Date.now()}_${Math.floor(Math.random() * 9999)}`;
  const mp3File = `${tmpDir}/tts_${uniq}_in.mp3`;
  const oggFile = `${tmpDir}/tts_${uniq}_out.ogg`;
  const natural = toColloquial(text);
  const settings = await aiSettings();
  if (process.env.GROQ_API_KEY && settings.provider !== "edge") {
    try {
      const chunks = splitTTSChunks(natural);
      if (!chunks.length) throw new Error("نص فارغ");
      const wavs = [];
      for (let i = 0; i < chunks.length; i++) {
        const p = `${tmpDir}/tts_${uniq}_${i}.wav`;
        await writeFile(p, await groqSpeak(chunks[i], settings.groqVoice));
        wavs.push(p);
      }
      const ffArgs = ["-y"];
      if (wavs.length > 1) {
        const listFile = `${tmpDir}/tts_${uniq}_list.txt`;
        await writeFile(listFile, wavs.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n") + "\n");
        ffArgs.push("-f", "concat", "-safe", "0", "-i", listFile);
      } else {
        ffArgs.push("-i", wavs[0]);
      }
      const gain = parseFloat(settings.gain);
      if (!isNaN(gain) && gain !== 1) ffArgs.push("-af", `volume=${gain}`);
      ffArgs.push("-c:a", "libopus", "-b:a", "48k", oggFile);
      await execFileAsync(ffmpegPath, ffArgs);
      return { buffer: await readFile(oggFile), mimetype: "audio/ogg; codecs=opus" };
    } catch (error) {
      console.error("Groq TTS Error (fallback edge-tts):", error.message);
    }
  }
  try {
    await runEdgeTTS(["--voice", settings.voice, "--rate=" + settings.rate, "--pitch=" + settings.pitch, "--text", natural, "--write-media", mp3File]);
    const egain = parseFloat(settings.gain);
    const eargs = ["-y", "-i", mp3File];
    if (!isNaN(egain) && egain !== 1) eargs.push("-af", `volume=${egain}`);
    eargs.push("-c:a", "libopus", "-b:a", "48k", oggFile);
    await execFileAsync(ffmpegPath, eargs);
    const buffer = await readFile(oggFile);
    return { buffer, mimetype: "audio/ogg; codecs=opus" };
  } catch (error) {
    console.error("TTS Error:", error.message);
    return null;
  }
}
