import Groq from "groq-sdk";
import { schoolInfo } from "./school-context.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function getAIResponse(userMessage) {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `${schoolInfo}\n\nتذكر: تكلم بالعامية الفلسطينية. كن مختصراً جداً (جملة أو جملتين).`,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      temperature: 0.7,
      max_tokens: 150,
    });

    return completion.choices[0]?.message?.content || "آسف، ما فهمت سؤالك. ممكن توضيح؟";
  } catch (error) {
    console.error("AI Error:", error.message);
    return "عذراً، صار مشكلة تقنية. جرب تكتبلي بعد شوي.";
  }
}
