import Groq from "groq-sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { schoolInfo, familyStyle, intimateStyle, bossStyle, trainerStyle, ownerStyle } from "./school-context.js";

const execFileAsync = promisify(execFile);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export const ERROR_REPLY = "هلا، فيه مشكلة مؤقتة، جرب تراسل تاني بعد شوي أو اكتب مدير سمير.";
const PRIMARY_MODEL = "groq/compound-mini";
const FALLBACK_MODELS = ["groq/compound", "qwen/qwen3.6-27b", "groq/compound-mini"];
const chatMemory = new Map();
const MEMORY_LIMIT = 6;

const NO_THINKING = `

مهم جداً: أجب فقط بالنص النهائي لردك على واتساب بالعامية الأردنية. لا تكتب أي قسم "thinking" أو "reasoning" أو "analysis" أو "تحليل" أو أي أفكار داخلية أو تعليمات أو شرح للطريقة التي تستخدمها، ولا تكرر كلام المستخدم. لا تبدأ أي رد بكلمة "User" أو "المستخدم" أو "تحليل" أو "Context" أو "السياق". ركّز على آخر رسالة للمستخدم وأجب عليها وحدها فوراً. الرد يجب أن يكون جملة أو جملتين طبيعيتين فقط.

`;

export function cleanReply(reply) {
  let s = (reply || "").trim();
  const ti = s.search(/thinking/i);
  if (ti !== -1) {
    const after = s.slice(ti + 8);
    const ai = after.search(/[Aa]nswer\s*:/i);
    if (ai !== -1) s = after.slice(ai + 7);
    else s = after;
  }
  const leak = /(User says:|Analyze User Input:|Analyze (the|this|user|input)|The user asks|Context:|Previous messages|Key info needed|Key information|Keep it short|Rule for|System:|Assistant:|مهم جداً|سؤال المستخدم|المستخدم قال|Context: Previous|The intent|The user is asking|I'll help)/i;
  const lines = (s || "").split(/\n+/)
    .map(l => l.replace(/^\s*[-•*\d.)]\s*/, "").trim())
    .filter(l => l && !leak.test(l));
  const arabicLines = lines.filter(l => /[\u0600-\u06FF]/.test(l));
  let text = arabicLines.join(" ") || "";
  text = text.replace(/^#{1,4}\s*/, "").replace(/\*\*/g, "").replace(/\s{2,}/g, " ").trim();
  if (leak.test(text)) return "";
  return text;
}

export async function getAIResponse(userMessage, isFamily = false, isIntimate = false, isBoss = false, isTrainer = false, isOwner = false, chatId = "") {
  const system = (isOwner ? schoolInfo + ownerStyle : isBoss ? schoolInfo + bossStyle : isTrainer ? schoolInfo + trainerStyle : isIntimate ? schoolInfo + intimateStyle : isFamily ? schoolInfo + familyStyle : schoolInfo) + NO_THINKING;
  const history = (chatMemory.get(chatId) || []).slice(-MEMORY_LIMIT);
  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS.filter(m => m !== PRIMARY_MODEL)];
  let lastError = null;
  for (const model of models) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          ...history,
          { role: "user", content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 200,
      });
      const raw = completion.choices[0]?.message?.content || "";
      const reply = cleanReply(raw) || "آسف، ما فهمت. ممكن توضيح؟";
      chatMemory.set(chatId, [...history, { role: "user", content: userMessage }, { role: "assistant", content: reply }].slice(-MEMORY_LIMIT));
      return reply;
    } catch (error) {
      lastError = error;
      if (error?.status === 429 && model === PRIMARY_MODEL) {
        let retried = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          console.error(`⚠️ ${model} معدل محدود — ننتظر ${(attempt + 1) * 4} ثواني ونعيد المحاولة`);
          await new Promise(r => setTimeout(r, (attempt + 1) * 4000));
          try {
            const retry = await groq.chat.completions.create({
              model,
              messages: [
                { role: "system", content: system },
                ...history,
                { role: "user", content: userMessage },
              ],
              temperature: 0.7,
              max_tokens: 200,
            });
            const raw = retry.choices[0]?.message?.content || "";
            const reply = cleanReply(raw) || "آسف، ما فهمت. ممكن توضيح؟";
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
  return ERROR_REPLY;
}

export async function getAIFactReply(fact, userMessage, isFamily = false, isIntimate = false, isBoss = false, isTrainer = false, chatId = "") {
  const style = isBoss ? bossStyle : isTrainer ? trainerStyle : isIntimate ? intimateStyle : isFamily ? familyStyle : "";
  const system = schoolInfo + style + `

مهم جداً: المستخدم سأل عن معلومة من المدرسة. المعلومة الصحيحة من سجلات المدرسة هي:
"""${fact}"""

رد على سؤال المستخدم بالعامية الأردنية بشكل طبيعي وإنساني تلقائي كشخص حقيقي، ليس كبوت ولا روبوت. عبّر عن المعلومة بكلماتك الطبيعية وكأنك سكرتيرة بتجاوب أحد على واتساب، لا تسقط كقائمة نقاط، ولا تحيّد عن المعلومة الصحيحة ولا تغيّر أي رقم منها، ولا تضف معلومات غير موجودة. ركّز على سؤال المستخدم الأخير فقط.`;
  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS.filter(m => m !== PRIMARY_MODEL)];
  for (const model of models) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMessage },
        ],
        temperature: 0.4,
        max_tokens: 250,
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

export async function textToSpeech(text) {
  const tmpDir = process.env.TMPDIR || "/tmp";
  const uniq = `${Date.now()}_${Math.floor(Math.random() * 9999)}`;
  const mp3File = `${tmpDir}/tts_${uniq}_in.mp3`;
  const oggFile = `${tmpDir}/tts_${uniq}_out.ogg`;
  const natural = toColloquial(text);
  try {
    await execFileAsync("python", ["-m", "edge_tts", "--voice", "ar-JO-SanaNeural", "--rate=-8%", "--pitch=-1Hz", "--text", natural, "--write-media", mp3File]);
    await execFileAsync(ffmpegPath, ["-y", "-i", mp3File, "-c:a", "libopus", "-b:a", "48k", oggFile]);
    const buffer = await readFile(oggFile);
    return { buffer, mimetype: "audio/ogg; codecs=opus" };
  } catch (error) {
    console.error("TTS Error:", error.message);
    return null;
  }
}
