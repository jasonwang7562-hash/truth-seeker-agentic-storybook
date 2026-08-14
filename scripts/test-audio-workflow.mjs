import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const manifestSource = fs.readFileSync(path.join(root, "public", "audio-manifest.js"), "utf8");
const storySource = fs.readFileSync(path.join(root, "public", "story-data.js"), "utf8");
const context = { globalThis: {} };

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

vm.createContext(context);
vm.runInContext(storySource, context, { filename: "story-data.js" });
vm.runInContext(manifestSource, context, { filename: "audio-manifest.js" });

const manifest = context.globalThis.EAZO_AUDIO_MANIFEST;
const story = context.globalThis.EAZO_STORY;
assert(manifest, "Audio manifest should be exported.");
assert(manifest.workflow.runtimeTts === false, "Runtime TTS should be disabled.");
assert(manifest.workflow.browserSpeechFallback === false, "Browser speech fallback should stay disabled.");
assert(manifest.workflow.guideAudio === false, "Fairy audio should stay disabled.");

for (const text of [
  "咦……这么多衣服还不够呀？你觉得他为什么一直想换新的？",
  "嗯，他好像真的很在意新衣服。",
  "原来最难的，不一定是看见真相。有时候，是第一个把它说出来。",
]) {
  const guidePath = manifest.guidePathForText(text);
  assert(
    /^\/assets\/audio\/guide\/[0-9a-f]{8}\.wav$/.test(guidePath),
    "Guide audio should use stable hashed WAV filenames."
  );
  const guideFilePath = path.join(root, "public", guidePath.replace(/^\//, ""));
  if (text.includes("原来最难的")) {
    assert(fs.existsSync(guideFilePath), `Missing required ending Guide audio file: ${guidePath}`);
    assert(fs.statSync(guideFilePath).size > 1024, `Guide audio file is empty: ${guidePath}`);
  }
}

const unitAudioPaths = story.pages.flatMap((page) =>
  page.units.map((unit) => unit.audioSrc).filter(Boolean)
);
assert(unitAudioPaths.length > 0, "Sentence audio should be attached to story units.");
for (const assetPath of unitAudioPaths) {
  assert(
    assetPath.startsWith("/assets/audio/units/"),
    `Sentence audio should use the unit directory: ${assetPath}`
  );
  assert(
    !assetPath.startsWith("/assets/audio/narration/"),
    `Old scene narration should not be attached to a unit: ${assetPath}`
  );
  const filePath = path.join(root, "public", assetPath.replace(/^\//, ""));
  assert(fs.existsSync(filePath), `Missing sentence audio file: ${assetPath}`);
  assert(fs.statSync(filePath).size > 1024, `Sentence audio file is empty: ${assetPath}`);
}

assert(
  !appSource.includes("speechSynthesis") && !appSource.includes("SpeechSynthesisUtterance"),
  "Synthetic browser speech should be removed from the story runtime."
);
assert(!appSource.includes("/api/speech"), "Runtime speech endpoint should not be called.");
assert(
  !appSource.includes("audioManifest.narrator"),
  "Runtime should not reference the old scene-level narrator manifest."
);
assert(
  !appSource.includes("speakNarration") && !appSource.includes("queueNarrationForCurrentPage"),
  "Legacy scene narration scheduling should be removed."
);
assert(
  appSource.includes("function playUnitAudio(unit)") && appSource.includes("unit.audioSrc"),
  "Runtime should play optional sentence audio from the active unit."
);
assert(
  appSource.includes("clearScheduledUnitAudio") && appSource.includes("stopUnitActivity"),
  "Manual navigation should stop scheduled and active unit audio."
);
assert(
  !appSource.includes("speakGuide") &&
    !appSource.includes("guideAudioPathForText") &&
    !appSource.includes('playStaticSpeech(path, text, "guide")') &&
    !appSource.includes("playBrowserSpeech"),
  "Fairy questions, feedback, and clues should remain text-only at runtime."
);
assert(appSource.includes("sound: true"), "Background sound should default to on for new sessions.");
assert(
  appSource.includes("window.addEventListener(\"pointerdown\", startBgm"),
  "Background sound should retry playback after the first user gesture."
);
assert(appSource.includes("const BGM_VOLUME = 0.14;"), "BGM should stay in the low demo range.");
assert(appSource.includes("const BGM_DUCKED_VOLUME = 0.055;"), "BGM should duck below speech.");

console.log("Offline audio workflow checks passed.");
