import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const storySource = fs.readFileSync(path.join(root, "public", "story-data.js"), "utf8");
const manifestSource = fs.readFileSync(path.join(root, "public", "audio-manifest.js"), "utf8");
const context = { globalThis: {} };

vm.createContext(context);
vm.runInContext(storySource, context, { filename: "story-data.js" });
vm.runInContext(manifestSource, context, { filename: "audio-manifest.js" });

const story = context.globalThis.EAZO_STORY;
const audio = context.globalThis.EAZO_AUDIO_MANIFEST;

function normalizeText(value) {
  return audio.normalizeText(value);
}

function addGuideLine(lines, source, text) {
  const normalized = normalizeText(text);
  if (!normalized) return;
  lines.set(normalized, {
    source,
    asset: audio.guidePathForText(normalized).replace(/^\//, "public/"),
    text: normalized,
  });
}

function segmentNarration(text) {
  const normalized = normalizeText(text);
  return (normalized.match(/[^。！？!?；;]+[。！？!?；;][”"]?|[^。！？!?；;]+$/g) || [normalized])
    .map((segment) => segment.trim())
    .filter(Boolean);
}

const narration = story.pages
  .filter((page) => page.narrationText)
  .map((page, index) => ({
    scene: index + 1,
    pageId: page.id,
    provider: audio.workflow.narratorProvider,
    asset: audio.narrator[page.id].replace(/^\//, "public/"),
    needsRegeneration: Boolean(page.narrationAudioNeedsRegeneration),
    text: normalizeText(page.narrationText),
    afterInteractionText: normalizeText(page.narrationAfterInteraction),
    segments: segmentNarration(page.narrationText),
    afterInteractionSegments: segmentNarration(page.narrationAfterInteraction),
  }));

const guideLines = new Map();
for (const checkpoint of story.checkpoints) {
  addGuideLine(guideLines, `${checkpoint.id}:question`, checkpoint.question);
  addGuideLine(guideLines, `${checkpoint.id}:retry:first`, checkpoint.retryGuidance?.first);
  addGuideLine(guideLines, `${checkpoint.id}:retry:exhausted`, checkpoint.retryGuidance?.exhausted);
  addGuideLine(guideLines, `${checkpoint.id}:fallback`, checkpoint.authoredFallback?.feedback);
}

const deterministicGuideFeedback = [
  "嗯，他好像真的很在意新衣服。",
  "嗯……好看是一回事。你看这一屋子的衣服，他是不是有点太在意啦？",
  "看不见，就要被人说不聪明？这话听着可真怪。先记下来。",
  "我也没看到……织布机一直在动，可布在哪儿呢？这个得记下来。",
  "透明的？嗯……那我们找找看，有没有什么证据。",
  "嗯，他好像怕别人觉得自己不聪明。",
  "我也在想这个！他明明什么都没看见，怎么就是不肯说呢？",
  "嗯……可能大家都在等别人先说真话。",
  "“皇帝根本没穿衣服！”你会这样说呀。",
  "嗯，我懂。周围所有人都在说“好漂亮”，这时候开口确实有点难。",
  "你可能也会先看看大家怎么说。其实故事里好多大人也是这样。",
];

deterministicGuideFeedback.forEach((line, index) => {
  addGuideLine(guideLines, `deterministic-feedback:${index + 1}`, line);
});

for (const clue of story.clues || []) {
  addGuideLine(guideLines, `${clue.id}:clue`, `${clue.title}。${clue.text}`);
}
addGuideLine(
  guideLines,
  "finish",
  "原来最难的，不一定是看见真相。有时候，是第一个把它说出来。"
);

const inventory = {
  generatedAt: new Date(0).toISOString(),
  note:
    "Use this deterministic inventory to generate offline audio. Narration targets IndexTTS2; Guide targets CosyVoice 2. Do not commit unlicensed reference recordings.",
  narrator: narration,
  guide: Array.from(guideLines.values()).sort((a, b) => a.asset.localeCompare(b.asset)),
};

if (process.argv.includes("--check")) {
  if (inventory.narrator.length !== 6) throw new Error("Expected six narration scenes.");
  if (inventory.guide.length < story.checkpoints.length) {
    throw new Error("Expected at least one Guide line per checkpoint.");
  }
}

console.log(JSON.stringify(inventory, null, 2));
