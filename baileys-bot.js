import "dotenv/config";
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import { getAIResponse } from "./ai.js";
import QR from "qrcode-terminal";

const SCHOOL_NAME = "مدرسة بديع لتعليم السياقة";
const PHONE = process.env.SCHOOL_PHONE || "0568444407";

function fmtPhone(p) {
  let c = p.replace(/\D/g, "");
  if (c.startsWith("0")) c = "972" + c.slice(1);
  return c;
}

const ownerJid = fmtPhone(PHONE) + "@s.whatsapp.net";

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("baileys_auth");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ["Chrome", "Linux", "120"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\n" + "=".repeat(40));
      console.log("\u{1F4F1} امسح QR من واتساب:\n");
      QR.generate(qr, { small: true });
      console.log("\n" + "=".repeat(40));
    }
    if (connection === "open") {
      console.log("\n\u2705 " + SCHOOL_NAME + " - المساعد متصل!");
    }
    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("\n\u{1F504} قطع الاتصال...");
      if (shouldReconnect) startBot();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;
    if (msg.key.remoteJid === "status@broadcast") return;

    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    if (!text.trim()) return;

    const sender = msg.key.remoteJid;
    if (sender === ownerJid) {
      console.log("\u{1F507} (المالك): " + text);
      return;
    }

    console.log("\u{1F4E9} " + sender + ": " + text);

    try {
      const reply = await getAIResponse(text);
      await sock.sendMessage(sender, { text: reply });
      console.log("\u2705 " + reply.slice(0, 60) + "...");
    } catch (err) {
      console.error("\u274C خطأ:", err.message);
    }
  });
}

console.log("\n\u{1F680} " + SCHOOL_NAME + " - المساعد الذكي يعمل...");
startBot();
