import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import transcribeRuntime from "../lib/transcribe-runtime.js";

const {
  handleTranscribeRequest,
  parseMultipartAudio,
  sanitizeTranscript,
  transcribeAudio,
} = transcribeRuntime;

const root = process.cwd();
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

function multipartBody(boundary, audioBody = "audio-bytes", fields = {}) {
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    );
  }
  chunks.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="answer.webm"\r\nContent-Type: audio/webm\r\n\r\n${audioBody}\r\n`
  );
  chunks.push(`--${boundary}--\r\n`);
  return Buffer.from(chunks.join(""), "latin1");
}

const boundary = "----eazo-voice-test";
const parsed = parseMultipartAudio(
  multipartBody(boundary, "fake-audio", { language: "zh" }),
  `multipart/form-data; boundary=${boundary}`
);
assert.equal(parsed.audio.filename, "answer.webm");
assert.equal(parsed.audio.contentType, "audio/webm");
assert.equal(parsed.audio.buffer.toString("latin1"), "fake-audio");
assert.equal(parsed.fields.language, "zh");

assert.equal(sanitizeTranscript("  没有\n布  "), "没有 布");
assert.equal(
  (await handleTranscribeRequest(
    {
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      buffer: multipartBody(boundary),
    },
    { OPENAI_API_KEY: "" }
  )).error,
  "missing_api_key"
);

const originalFetch = globalThis.fetch;
try {
  let providerCall = null;
  globalThis.fetch = async (url, options) => {
    providerCall = { url, options };
    return {
      ok: true,
      async json() {
        return { text: " 没有布 " };
      },
    };
  };

  const live = await transcribeAudio(
    {
      buffer: Buffer.from("fake-audio"),
      contentType: "audio/webm",
      filename: "answer.webm",
    },
    { language: "zh" },
    {
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: "https://api.test/v1",
      OPENAI_STT_MODEL: "whisper-1",
    }
  );
  assert.equal(live.ok, true);
  assert.equal(live.transcript, "没有布");
  assert.equal(providerCall.url, "https://api.test/v1/audio/transcriptions");
  assert.equal(providerCall.options.headers.Authorization, "Bearer test-key");
  assert.equal(providerCall.options.method, "POST");

  globalThis.fetch = async () => ({ ok: false, status: 503 });
  const failed = await transcribeAudio(
    {
      buffer: Buffer.from("fake-audio"),
      contentType: "audio/webm",
      filename: "answer.webm",
    },
    {},
    { OPENAI_API_KEY: "test-key" }
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "provider_error");
} finally {
  globalThis.fetch = originalFetch;
}

assert(appSource.includes("navigator.mediaDevices.getUserMedia"), "Voice input should request microphone access.");
assert(appSource.includes("new MediaRecorder"), "Voice input should use MediaRecorder.");
assert(appSource.includes("webkitSpeechRecognition"), "Voice input should support browser speech recognition.");
assert(appSource.includes("startBrowserSpeechRecognition"), "Voice input should try browser transcription when available.");
assert(appSource.includes('fetch("/api/transcribe"'), "Voice input should call the shared transcription endpoint.");
assert(
  appSource.includes("submitCheckpointAnswer(activePage, activeCheckpoint, answer)"),
  "Voice transcripts should submit through the existing answer pipeline."
);
assert(appSource.includes("voiceBusyBlocksSubmit()"), "Voice recording/transcribing should block duplicate submit.");
assert(appSource.includes("window.addEventListener(\"pagehide\", resetVoiceState"), "Voice tracks should be cleaned up on page exit.");
assert(appSource.includes("speechOutputActive"), "Voice recording should coordinate with sentence audio playback.");

console.log("Voice input checks passed.");
