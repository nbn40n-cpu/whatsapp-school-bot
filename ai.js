import Groq from "groq-sdk";
import { schoolInfo } from "./school-context.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function getAIResponse(userMessage) {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: schoolInfo },
        { role: "user", content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 180,
    });
    return completion.choices[0]?.message?.content || "آسف، ما فهمت. ممكن توضيح؟";
  } catch (error) {
    console.error("AI Error:", error.message);
    return "أعتذر، يرجى مراسلة المدرب سمير بعد المغرب أو مراجعة المدرسة.";
  }
}
