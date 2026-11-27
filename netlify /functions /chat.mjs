/**
 * NOVA AI — Secure Serverless Gemini Proxy (Netlify Functions ESM)
 * Environment Variable Required: GEMINI_API_KEY
 */

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_INSTRUCTION =
  "You are NOVA AI ('Your Intelligence. Your Universe.'), an advanced, precise, and futuristic AI assistant. " +
  "Provide clear, structured, well-formatted Markdown answers. Use fenced code blocks with language tags for code.";

// Simple per-instance sliding-window rate limiter (20 requests per minute per IP)
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const ipRequestLog = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (ipRequestLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    ipRequestLog.set(ip, timestamps);
    return true;
  }

  timestamps.push(now);
  ipRequestLog.set(ip, timestamps);
  return false;
}

function jsonResponse(statusCode, payload) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export default async (request, context) => {
  // 1. Enforce HTTP POST
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed. Use POST." });
  }

  // 2. Verify Server API Key Configuration
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("CRITICAL: GEMINI_API_KEY environment variable is not set.");
    return jsonResponse(500, {
      error: "Server configuration error: GEMINI_API_KEY is missing in Netlify environment variables.",
    });
  }

  // 3. Rate Limiting Check
  const clientIp =
    context?.ip ||
    request.headers.get("x-nf-client-connection-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";

  if (isRateLimited(clientIp)) {
    return jsonResponse(429, {
      error: "Rate limit exceeded. Please wait a moment before sending another message.",
    });
  }

  // 4. Parse & Validate Payload
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON request body." });
  }

  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse(400, { error: "Validation error: 'messages' must be a non-empty array." });
  }

  if (messages.length > 30) {
    return jsonResponse(400, { error: "Conversation context exceeds maximum allowed turns." });
  }

  // Transform and sanitize conversation turns into Gemini API format
  const contents = [];
  for (const msg of messages) {
    if (!msg || typeof msg.text !== "string" || !msg.text.trim()) {
      return jsonResponse(400, { error: "Each message must contain non-empty text." });
    }
    if (msg.text.length > 8000) {
      return jsonResponse(400, { error: "Message exceeds 8,000 character limit." });
    }
    const role = msg.role === "model" ? "model" : "user";
    contents.push({
      role,
      parts: [{ text: msg.text.trim() }],
    });
  }

  // 5. Call Official Gemini API
  try {
    const geminiResponse = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      }),
    });

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      const apiMsg = geminiData?.error?.message || "Upstream Gemini API error.";
      console.error("Gemini API Error:", geminiResponse.status, apiMsg);
      return jsonResponse(geminiResponse.status === 429 ? 429 : 502, {
        error: `AI Service Error: ${apiMsg}`,
      });
    }

    const replyText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!replyText) {
      return jsonResponse(502, {
        error: "NOVA AI could not generate a response for this prompt (possibly blocked by safety filters).",
      });
    }

    return jsonResponse(200, { reply: replyText });
  } catch (error) {
    console.error("Unhandled Function Error:", error);
    return jsonResponse(500, { error: "Internal server error while contacting Gemini API." });
  }
};



