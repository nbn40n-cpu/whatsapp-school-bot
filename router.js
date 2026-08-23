import { getStore } from "./store.js";

function normAr(s) {
  return (s || "")
    .replace(/[\u064B-\u0652\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0600-\u06FF\s]/g, "");
}

function hasWord(raw, norm, word) {
  const normW = normAr(word);
  const p = normW.replace(/[^\u0600-\u06FF]/g, "\\s*");
  const re = new RegExp("(^|[^\\u0600-\\u06FF])" + p + "([^\\u0600-\\u06FF]|$)");
  return re.test(norm) || re.test(raw);
}

function matchEntry(raw, norm, e) {
  const trigs = e.triggers || [];
  if (!trigs.length) return false;
  const mode = e.matchMode || "contains";
  return trigs.some((t) => {
    if (!t || !t.trim()) return false;
    if (mode === "word") return hasWord(raw, norm, t);
    if (mode === "regex") {
      try { return new RegExp(t, "i").test(raw || ""); } catch (_) { return false; }
    }
    return raw.includes(t) || norm.includes(normAr(t));
  });
}

// مدخلات ظلّتها handleFAQ بمنطق أذكى (سياق النوع) — محظورة من المخزن نهائياً حتى لو رجعت active
const STORE_SKIP_IDS = new Set([
  "faq-005", "faq-008", "faq-010", "faq-011", "faq-012", "faq-013",
  "faq-017", "faq-018", "faq-019", "faq-020", "faq-021", "faq-022",
  "faq-mt1xm6jg-6n9",
]);

export async function findStoreReply(raw, norm) {
  try {
    const s = await getStore();
    const faqs = (s.faq || []).filter((f) => f && f.managed && f.active !== false && !STORE_SKIP_IDS.has(f.id));
    for (const f of faqs) {
      if (matchEntry(raw, norm, f)) {
        return { reply: f.reply || "", faq: f };
      }
    }
  } catch (e) {
    console.error("store reply error:", e.message);
  }
  return null;
}