import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const storyPath = path.join(root, "public", "story-data.js");
const source = fs.readFileSync(storyPath, "utf8");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
const context = { globalThis: {} };

vm.createContext(context);
vm.runInContext(source, context, { filename: storyPath });

const story = context.globalThis.EAZO_STORY;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(story, "Story data should be exported.");
assert(story.pages.length === 7, "Story should include entry plus six scenes.");
assert(story.metadata.runtime === "unit-storybook", "Story should use the unit storybook runtime.");
assert(story.agent && story.agent.id === "guide", "Story should use one Guide Agent.");
assert(story.agent.architecture === "single-guide", "Agent architecture should be single-guide.");
assert(story.checkpoints.length === 6, "Story should define six Agent checkpoints.");
assert(story.clues.length === 4, "Story should define four reasoning clues.");
assert(
  appSource.includes("function renderAffordance(canAdvance)") &&
    appSource.includes("点击继续 ›"),
  "The first unit should keep a clean continue affordance without visible arrow controls."
);
assert(
  appSource.includes("function continueStory()") &&
    appSource.includes("function goBack()"),
  "Stage navigation handlers should be defined."
);
assert(
  !appSource.includes("state.pageIndex"),
  "Navigation should use the currentSceneIndex state field."
);
assert(!appSource.includes("unit-nav-visual"), "Sentence navigation should not render arrow visuals.");
assert(
  appSource.includes("if (state.activeClue || state.finished || !checkpoint || !checkpointState) return \"\";"),
  "Clue and finished overlays should suppress the underlying Q&A card."
);
assert(
  stylesSource.includes("--reader-button-size: clamp(56px, 4.48vw, 67px)") &&
    stylesSource.includes("--reader-card-max: 940px"),
  "Reader controls should use the smaller 70% bottom-button contract and dialogue cards should be gently tightened."
);
assert(
  !appSource.includes("也可以点麦克风说出来。") &&
    appSource.includes("if (!stateForVoice.message) return \"\";"),
  "Idle microphone helper copy should stay out of the dialogue box."
);
assert(
  appSource.includes("${renderStoryTextPanel(page, currentUnit())}") &&
    !appSource.includes("📖 旁白"),
  "Narration units should render in the story box without a narrator title."
);
assert(
  appSource.includes("const leftThird = bounds.width / 3;") &&
    appSource.includes("goToPreviousUnit();"),
  "Stage clicks should use left-third previous and right-side next navigation."
);
assert(
  stylesSource.includes(".agent-card.story-unit-card") &&
    stylesSource.includes(".agent-overlay .agent-card") &&
    stylesSource.includes("font-family: var(--story-copy-font)"),
  "Narration and fairy dialogue should share the same story font."
);

const ids = story.pages.map((page) => page.id);
const allowedUnitTypes = new Set(["narration", "dialogue", "question"]);
for (const page of story.pages) {
  assert(Array.isArray(page.units) && page.units.length > 0, `Page needs ordered units: ${page.id}`);
  for (const unit of page.units) {
    assert(allowedUnitTypes.has(unit.type), `Unsupported unit type on ${page.id}: ${unit.type}`);
    if (unit.type === "narration" || unit.type === "dialogue") {
      assert(unit.text && unit.text.trim(), `Literary unit needs text on ${page.id}`);
      assert("audioSrc" in unit, `Literary unit needs an optional audioSrc on ${page.id}`);
      assert(
        unit.audioSrc === null || typeof unit.audioSrc === "string",
        `audioSrc should be null or a string on ${page.id}`
      );
      if (unit.type === "dialogue") {
        assert(unit.speaker && unit.speaker.trim(), `Dialogue unit needs a speaker on ${page.id}`);
      }
    }
    if (unit.type === "question") {
      assert(unit.checkpointId, `Question unit needs a checkpoint id on ${page.id}`);
      assert(!("text" in unit), `Question unit should reuse checkpoint text on ${page.id}`);
    }
  }
}

const sceneLabels = [
  ["wardrobe", "场景一：爱新衣的国王"],
  ["scammers", "场景二：神奇的布料"],
  ["weaving", "场景三：神秘的织布房"],
  ["mirror", "场景四：国王穿上“新衣”"],
  ["parade", "场景五：盛大的游行"],
  ["truth", "场景六：孩子说出了真相"],
];
for (const [id, sceneLabel] of sceneLabels) {
  assert(ids.includes(id), `Missing page: ${id}`);
  const page = story.pages.find((item) => item.id === id);
  assert(page.narrationText && page.narrationText.length > 20, `Missing narration text: ${id}`);
  assert(!page.narrationText.startsWith(sceneLabel), `Scene title should not be a story unit: ${id}`);
  assert(
    !page.units.some((unit) => unit.text && unit.text.startsWith(sceneLabel)),
    `Scene title should stay out of the dialogue box: ${id}`
  );
}

const revisedPages = ["wardrobe", "scammers", "weaving", "mirror", "parade"].map((id) =>
  story.pages.find((page) => page.id === id)
);
for (const page of revisedPages) {
  assert(page.narrationAfterInteraction, `Revised scene should include after-interaction narration: ${page.id}`);
}

const weaving = story.pages.find((page) => page.id === "weaving");
assert(!weaving.narrationText.includes("其实什么也没有"), "Weaving setup should not reveal the empty loom early.");
assert(!weaving.narrationText.includes("空空"), "Weaving setup should keep the detective observation open.");

const mirror = story.pages.find((page) => page.id === "mirror");
assert(!mirror.narrationText.includes("什么都没有看见"), "Mirror setup should not reveal the emperor's fear early.");
assert(mirror.narrationText.includes("纷纷称赞"), "Mirror scene should include praise before the Guide checkpoint.");

const parade = story.pages.find((page) => page.id === "parade");
assert(!parade.narrationText.includes("害怕自己被认为"), "Parade setup should not explain crowd fear early.");

const wardrobe = story.pages.find((page) => page.id === "wardrobe");
assert(!("requiredSelections" in wardrobe), "Wardrobe should not require scene interaction before the Guide.");

const scammers = story.pages.find((page) => page.id === "scammers");
assert(!("requiredQuestionsBeforeCheckpoint" in scammers), "Scammer checkpoint should not require scene interaction.");

const truth = story.pages.find((page) => page.id === "truth");
assert(!("autoCheckpointWhenReady" in truth), "Final reflection should stay Guide-only without choice gates.");

const removedInteractionKeys = [
  "items",
  "emperorReplies",
  "questions",
  "evidence",
  "inspection",
  "compare",
  "people",
  "crowdChoices",
];
for (const page of story.pages) {
  for (const key of removedInteractionKeys) {
    assert(!(key in page), `Scene interaction data should be removed from ${page.id}: ${key}`);
  }
}

const clues = story.clues.map((clue) => clue.id);
assert(clues.length === 4, "There should be four reasoning clues.");
assert(new Set(clues).size === clues.length, "Clue ids should be unique.");
assert(
  clues.join("|") ===
    "clue-strange-words|clue-empty-loom|clue-mirror-truth|clue-crowd-conformity",
  "Clue chain should follow the authored reasoning order."
);

const checkpointIds = story.checkpoints.map((checkpoint) => checkpoint.id);
assert(new Set(checkpointIds).size === checkpointIds.length, "Checkpoint ids should be unique.");
const checkpointPages = new Set(story.checkpoints.map((checkpoint) => checkpoint.pageId));
assert(checkpointPages.size === story.checkpoints.length, "Each checkpoint should map to one page.");
for (const checkpoint of story.checkpoints) {
  const page = story.pages.find((item) => item.id === checkpoint.pageId);
  assert(page, `Checkpoint page is missing: ${checkpoint.pageId}`);
  assert(page.checkpointId === checkpoint.id, `Page should reference checkpoint: ${checkpoint.id}`);
  const questionUnits = page.units.filter((unit) => unit.type === "question");
  assert(questionUnits.length === 1, `Scene should contain one ordered question unit: ${page.id}`);
  assert(
    questionUnits[0].checkpointId === checkpoint.id,
    `Question unit should reference the existing checkpoint: ${checkpoint.id}`
  );
  assert(checkpoint.question, `Checkpoint needs a question: ${checkpoint.id}`);
  assert(checkpoint.educationalGoal, `Checkpoint needs an educational goal: ${checkpoint.id}`);
  assert(checkpoint.rubric && checkpoint.rubric.categories, `Checkpoint needs a rubric: ${checkpoint.id}`);
  assert(checkpoint.maxAttempts >= 1, `Checkpoint needs a positive attempt limit: ${checkpoint.id}`);
  assert(checkpoint.retryGuidance && checkpoint.retryGuidance.first, `Checkpoint needs retry guidance: ${checkpoint.id}`);
  assert(checkpoint.authoredFallback && checkpoint.authoredFallback.feedback, `Checkpoint needs a fallback: ${checkpoint.id}`);
  if (checkpoint.clueId) {
    assert(story.clues.some((clue) => clue.id === checkpoint.clueId), `Missing checkpoint clue: ${checkpoint.clueId}`);
  }
  assert(
    checkpoint.pageId === "truth"
      ? checkpoint.rubric.type === "reflection"
      : checkpoint.rubric.type === "factual",
    `Checkpoint rubric type is inconsistent: ${checkpoint.id}`
  );
}
for (const page of story.pages) {
  if (!page.checkpointId) {
    assert(!checkpointPages.has(page.id), `Ordinary page should not require an Agent: ${page.id}`);
  }
}

for (const page of story.pages.filter((item) => item.type !== "entry")) {
  const literaryText = page.units
    .filter((unit) => unit.type === "narration" || unit.type === "dialogue")
    .map((unit) =>
      unit.type === "dialogue" ? `${unit.speaker || "角色"}：“${unit.text || ""}”` : unit.text || ""
    )
    .join("");
  const questionIndex = page.units.findIndex((unit) => unit.type === "question");
  const beforeQuestion = page.units.slice(0, questionIndex);
  const afterQuestion = page.units.slice(questionIndex + 1);
  const textFor = (units) =>
    units
      .filter((unit) => unit.type === "narration" || unit.type === "dialogue")
      .map((unit) =>
        unit.type === "dialogue" ? `${unit.speaker || "角色"}：“${unit.text || ""}”` : unit.text || ""
      )
      .join("");

  assert(page.fullText === literaryText, `Full scene text should derive from units: ${page.id}`);
  assert(page.narrationText === textFor(beforeQuestion), `Opening text should derive from units: ${page.id}`);
  assert(
    (page.narrationAfterInteraction || "") === textFor(afterQuestion),
    `Closing text should derive from units: ${page.id}`
  );
  assert(!page.fullText.includes(story.checkpoints.find((item) => item.pageId === page.id).question),
    `Full literary text should exclude Guide questions: ${page.id}`);
}

const assetRefs = story.pages.flatMap((page) =>
  [page.image, page.alternateImage, page.revealImage].filter(Boolean)
);
for (const ref of assetRefs) {
  const filePath = path.join(root, "public", ref.replace(/^\//, ""));
  assert(fs.existsSync(filePath), `Missing asset: ${ref}`);
}

const unitAudioRefs = story.pages.flatMap((page) =>
  page.units.map((unit) => unit.audioSrc).filter(Boolean)
);
assert(unitAudioRefs.length > 0, "Story units should use the supplied sentence audio files.");
for (const ref of unitAudioRefs) {
  assert(ref.startsWith("/assets/audio/units/"), `Unit audio should use the sentence-audio directory: ${ref}`);
  const filePath = path.join(root, "public", ref.replace(/^\//, ""));
  assert(fs.existsSync(filePath), `Missing unit audio file: ${ref}`);
  assert(fs.statSync(filePath).size > 1024, `Unit audio file is empty: ${ref}`);
}

for (const ref of [
  "assets/guide/fairy-guide-neutral.png",
  "assets/guide/fairy-guide-positive.png",
  "assets/audio/bgm-global.mp3",
]) {
  assert(fs.existsSync(path.join(root, "public", ref)), `Missing browser asset: ${ref}`);
}

console.log("Story config checks passed.");
