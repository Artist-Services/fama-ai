const DEFAULT_FAMA_CHAT_URL = "https://fama-ai-voice.farzad-tattoo72.workers.dev/chat";
const DEFAULT_GRAPH_VERSION = "v26.0";

const SYSTEM_PROMPT = `تو دستیار دایرکت برند LUSIFER TATTOO هستی.
همیشه فارسی روان، محترمانه، صمیمی و حرفه‌ای پاسخ بده.
در نقش ادمین پاسخ‌گو به مشتریان تتو صحبت کن.
برای قیمت، زمان خالی، آدرس، بیعانه یا هر اطلاعاتی که در پیام‌ها و تنظیمات در اختیارت نیست، عدد یا اطلاعات نساز؛ سؤال روشن بپرس یا بگو ادمین شخصاً بررسی می‌کند.
تشخیص پزشکی، تضمین نتیجه یا توصیه خطرناک نده.
اگر درخواست خارج از خدمات تتو بود، کوتاه و مؤدبانه راهنمایی کن.
پاسخ را کوتاه و مناسب دایرکت اینستاگرام نگه دار.
اگر کاربر درخواست صحبت با انسان کرد، بگو پیامش برای پیگیری به ادمین ارجاع می‌شود؛ ادعا نکن واقعاً ارجاع انجام شده مگر اینکه چنین قابلیتی تنظیم شده باشد.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=") || !appSecret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = "sha256=" + bytesToHex(digest);
  if (expected.length !== signatureHeader.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  return mismatch === 0;
}

async function createReply(text, senderId, env) {
  const historyKey = "ig-thread:" + senderId;
  let history = [];
  if (env.FAMA_KV) {
    try {
      history = JSON.parse((await env.FAMA_KV.get(historyKey)) || "[]");
      if (!Array.isArray(history)) history = [];
    } catch {
      history = [];
    }
  }

  const currentMessage = { role: "user", content: text.slice(0, 4000) };
  const response = await fetch(env.FAMA_CHAT_URL || DEFAULT_FAMA_CHAT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.slice(-12),
        currentMessage
      ]
    })
  });
  if (!response.ok) throw new Error("FAMA_CHAT_HTTP_" + response.status);
  const data = await response.json();
  if (!data || typeof data.reply !== "string" || !data.reply.trim()) {
    throw new Error("FAMA_CHAT_EMPTY_REPLY");
  }
  const reply = data.reply.trim().slice(0, 1000);

  if (env.FAMA_KV) {
    const nextHistory = [...history.slice(-10), currentMessage, { role: "assistant", content: reply }];
    await env.FAMA_KV.put(historyKey, JSON.stringify(nextHistory), { expirationTtl: 604800 });
  }
  return reply;
}

async function sendInstagramMessage(recipientId, text, env) {
  const version = env.GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION;
  const url = `https://graph.instagram.com/${version}/${env.IG_USER_ID}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.IG_ACCESS_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text }
    })
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error("INSTAGRAM_SEND_HTTP_" + response.status + ": " + detail);
  }
}

async function handleWebhookPost(request, env) {
  const rawBody = await request.text();
  if (!(await verifySignature(rawBody, request.headers.get("x-hub-signature-256"), env.META_APP_SECRET))) {
    return json({ error: "INVALID_SIGNATURE" }, 401);
  }

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return json({ error: "INVALID_JSON" }, 400); }

  if (payload.object !== "instagram" || !Array.isArray(payload.entry)) {
    return json({ received: true });
  }

  for (const entry of payload.entry) {
    for (const event of (entry.messaging || [])) {
      const message = event.message;
      const senderId = event.sender && event.sender.id;
      const recipientId = event.recipient && event.recipient.id;
      const text = message && message.text;
      if (!message || message.is_echo || !senderId || !recipientId || !text || !message.mid) continue;
      if (String(senderId) === String(env.IG_USER_ID)) continue;

      const dedupeKey = "ig-mid:" + message.mid;
      if (env.FAMA_KV) {
        const seen = await env.FAMA_KV.get(dedupeKey);
        if (seen) continue;
        await env.FAMA_KV.put(dedupeKey, "1", { expirationTtl: 86400 });
      }

      try {
        const reply = await createReply(text, senderId, env);
        await sendInstagramMessage(senderId, reply, env);
      } catch (error) {
        console.error("Instagram DM processing failed:", error instanceof Error ? error.message : "unknown error");
        // Return 200 so Meta does not endlessly retry a message that failed upstream.
      }
    }
  }

  return json({ received: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/webhook") return json({ error: "NOT_FOUND" }, 404);

    if (request.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token && token === env.META_VERIFY_TOKEN && challenge) {
        return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
      }
      return json({ error: "WEBHOOK_VERIFICATION_FAILED" }, 403);
    }

    if (request.method === "POST") return handleWebhookPost(request, env);
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }
};
