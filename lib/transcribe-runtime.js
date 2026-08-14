const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_STT_MODEL = "whisper-1";
const DEFAULT_STT_LANGUAGE = "zh";
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 280;

const MIME_EXTENSIONS = {
  "audio/webm": ".webm",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
};

function loadDotEnv(env = process.env) {
  try {
    const fs = require("fs");
    const path = require("path");
    const envPath = path.join(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (key && env[key] === undefined) env[key] = value;
    }
  } catch {
    // Local .env loading is best effort.
  }
}

function sanitizeTranscript(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TRANSCRIPT_CHARS);
}

function headerValue(headers = {}, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const lower = name.toLowerCase();
  return headers[name] || headers[lower] || "";
}

function baseMimeType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function filenameFor(contentType, filename) {
  const safe = String(filename || "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (safe && /\.[a-z0-9]{2,5}$/i.test(safe)) return safe;
  const extension = MIME_EXTENSIONS[baseMimeType(contentType)] || ".webm";
  return `${safe || "answer"}${extension}`;
}

function failure(error, message) {
  return { ok: false, error, message };
}

function parseMultipartAudio(buffer, contentType) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("invalid_body");
  }
  if (!buffer.length) {
    throw new Error("empty_audio");
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new Error("audio_too_large");
  }

  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  const boundary = boundaryMatch && (boundaryMatch[1] || boundaryMatch[2]);
  if (!boundary) {
    throw new Error("missing_boundary");
  }

  const raw = buffer.toString("latin1");
  const sections = raw.split(`--${boundary}`).slice(1, -1);
  const fields = {};
  let audio = null;

  for (const section of sections) {
    const normalized = section.replace(/^\r?\n/, "");
    const headerEnd = normalized.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;

    const headerLines = normalized.slice(0, headerEnd).split(/\r\n/);
    const bodyRaw = normalized.slice(headerEnd + 4).replace(/\r\n$/, "");
    const body = Buffer.from(bodyRaw, "latin1");
    const headers = {};
    for (const line of headerLines) {
      const index = line.indexOf(":");
      if (index < 0) continue;
      headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }

    const disposition = headers["content-disposition"] || "";
    const nameMatch = /name="([^"]+)"/i.exec(disposition);
    const filenameMatch = /filename="([^"]*)"/i.exec(disposition);
    const name = nameMatch && nameMatch[1];
    if (!name) continue;

    if (filenameMatch || name === "audio" || name === "file") {
      const contentTypeHeader = headers["content-type"] || "audio/webm";
      const mime = baseMimeType(contentTypeHeader);
      if (mime && !mime.startsWith("audio/") && mime !== "application/octet-stream") {
        throw new Error("unsupported_audio_type");
      }
      audio = {
        buffer: body,
        contentType: mime === "application/octet-stream" ? "audio/webm" : contentTypeHeader,
        filename: filenameFor(contentTypeHeader, filenameMatch && filenameMatch[1]),
      };
    } else {
      fields[name] = body.toString("utf8").trim();
    }
  }

  if (!audio || !audio.buffer.length) {
    throw new Error("empty_audio");
  }

  return { audio, fields };
}

async function transcribeAudio(audio, fields = {}, env = process.env) {
  loadDotEnv(env);

  if (!env.OPENAI_API_KEY) {
    return failure(
      "missing_api_key",
      "现在还听不清你的声音，可以先打字告诉小侦探。"
    );
  }

  if (!globalThis.fetch || !globalThis.FormData || !globalThis.Blob) {
    return failure("unsupported_runtime", "这里暂时不能识别语音，可以先打字。");
  }

  const baseUrl = (env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = env.OPENAI_STT_MODEL || env.OPENAI_TRANSCRIBE_MODEL || DEFAULT_STT_MODEL;
  const language = fields.language || env.OPENAI_STT_LANGUAGE || DEFAULT_STT_LANGUAGE;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const form = new FormData();
    form.append("file", new Blob([audio.buffer], { type: audio.contentType }), audio.filename);
    form.append("model", model);
    form.append("language", language);
    form.append("response_format", "json");

    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      signal: controller.signal,
      body: form,
    });

    if (!response.ok) {
      return failure("provider_error", "这次没听清。可以再录一次，或者直接打字。");
    }

    const json = await response.json();
    const transcript = sanitizeTranscript(json && (json.text || json.transcript));
    if (!transcript) {
      return failure("empty_transcript", "我没有听清楚。可以再说一次，或者打字。");
    }

    return { ok: true, mode: "live", model, transcript };
  } catch (error) {
    return failure(
      error && error.name === "AbortError" ? "timeout" : "transcription_failed",
      "这次没听清。可以再录一次，或者直接打字。"
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function handleTranscribeRequest(input = {}, env = process.env) {
  try {
    const contentType = headerValue(input.headers, "content-type");
    const { audio, fields } = parseMultipartAudio(input.buffer, contentType);
    return transcribeAudio(audio, fields, env);
  } catch (error) {
    const reason = error && error.message;
    if (reason === "audio_too_large") {
      return failure("audio_too_large", "这段有点长。请短一点说，或者打字。");
    }
    if (reason === "unsupported_audio_type") {
      return failure("unsupported_audio_type", "这里暂时不能识别这种录音格式，可以先打字。");
    }
    return failure("bad_audio", "我没有听清楚。可以再说一次，或者打字。");
  }
}

function readBinaryBody(req, maxBytes = MAX_AUDIO_BYTES + 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = {
  handleTranscribeRequest,
  parseMultipartAudio,
  readBinaryBody,
  sanitizeTranscript,
  transcribeAudio,
};
