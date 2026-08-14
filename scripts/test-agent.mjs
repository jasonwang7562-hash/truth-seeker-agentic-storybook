import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  compactUserPrompt,
  handleAgentRequest,
  normalizeCheckpoint,
  normalizeStoryContext,
  systemPromptFor,
  validateAgentResult,
} from "../lib/agent-runtime.js";

const root = process.cwd();
const storySource = fs.readFileSync(path.join(root, "public", "story-data.js"), "utf8");
const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(storySource, context, { filename: "public/story-data.js" });
const story = context.globalThis.EAZO_STORY;

function checkpoint(id) {
  const value = story.checkpoints.find((item) => item.id === id);
  assert(value, `Missing checkpoint: ${id}`);
  return value;
}

function requestFor(value, answer, attempt = 1) {
  const page = story.pages.find((item) => item.id === value.pageId);
  const questionIndex = page.units.findIndex(
    (unit) => unit.type === "question" && unit.checkpointId === value.id
  );
  const sceneExcerpt = page.units
    .slice(0, questionIndex >= 0 ? questionIndex : page.units.length)
    .filter((unit) => unit.type === "narration" || unit.type === "dialogue")
    .slice(-5)
    .map((unit) =>
      unit.type === "dialogue" ? `${unit.speaker}：“${unit.text}”` : unit.text
    )
    .join(" ");
  return {
    checkpointId: value.id,
    question: value.question,
    educationalGoal: value.educationalGoal,
    rubric: value.rubric,
    maxAttempts: value.maxAttempts,
    clueId: value.clueId || "",
    retryGuidance: value.retryGuidance,
    storyContext: {
      pageId: page.id,
      title: page.title,
      chapter: page.chapter,
      guide: page.guide,
      guideReaction: page.guideReaction || "",
      sceneExcerpt,
    },
    sessionMemory: {
      acquiredClues: [story.clues[0]],
      priorCheckpoints: [
        {
          id: "checkpoint-wardrobe-motivation",
          category: "PARTIAL",
          childAnswer: "因为衣服好看",
        },
      ],
    },
    childAnswer: answer,
    attempt,
  };
}

async function fallbackAnswer(id, answer, attempt = 1) {
  return handleAgentRequest(requestFor(checkpoint(id), answer, attempt), {
    OPENAI_API_KEY: "",
  });
}

const z = checkpoint("checkpoint-wardrobe-motivation");
const a = checkpoint("checkpoint-suspicious-wording");
const b = checkpoint("checkpoint-empty-loom");
const m = checkpoint("checkpoint-mirror-truth");
const c = checkpoint("checkpoint-parade-conformity");
const d = checkpoint("checkpoint-final-reflection");

assert.equal((await fallbackAnswer(z.id, "因为他喜欢漂亮衣服")).result.category, "UNDERSTANDS");
assert.equal((await fallbackAnswer(z.id, "因为衣服好看")).result.category, "PARTIAL");
assert.equal((await fallbackAnswer(z.id, "不知道")).result.category, "UNSURE");
assert.equal((await fallbackAnswer(a.id, "这句话很奇怪")).result.category, "UNDERSTANDS");
assert.equal((await fallbackAnswer(a.id, "有点奇怪")).result.category, "PARTIAL");
assert.equal((await fallbackAnswer(a.id, "因为聪明的人才能看见")).result.category, "MISUNDERSTANDS");
assert.equal((await fallbackAnswer(a.id, "不知道")).result.category, "UNSURE");
assert.equal((await fallbackAnswer(a.id, "我喜欢红色")).result.category, "OFF_TOPIC");

assert.equal((await fallbackAnswer(b.id, "没有布")).result.category, "UNDERSTANDS");
assert.equal((await fallbackAnswer(b.id, "好像没有")).result.category, "PARTIAL");
assert.equal((await fallbackAnswer(b.id, "可能是透明的")).result.category, "MISUNDERSTANDS");
assert.equal((await fallbackAnswer(b.id, "")).result.category, "UNSURE");

assert.equal((await fallbackAnswer(m.id, "他没看到，但是怕别人说他不聪明")).result.category, "UNDERSTANDS");
assert.equal((await fallbackAnswer(m.id, "他没有看到衣服")).result.category, "PARTIAL");
assert.equal((await fallbackAnswer(m.id, "好像有点不对")).result.category, "PARTIAL");
assert.equal((await fallbackAnswer(m.id, "他真的看到漂亮新衣")).result.category, "MISUNDERSTANDS");

assert.equal((await fallbackAnswer(c.id, "他们只是跟着别人说")).result.category, "UNDERSTANDS");
assert.equal((await fallbackAnswer(c.id, "他们不一定都看见了")).result.category, "UNDERSTANDS");
assert.equal((await fallbackAnswer(c.id, "大家都看见了")).result.category, "MISUNDERSTANDS");
assert.equal((await fallbackAnswer(c.id, "不知道")).result.category, "UNSURE");

assert.equal((await fallbackAnswer(d.id, "我会说出来")).result.category, "SPEAK_TRUTH");
assert.equal((await fallbackAnswer(d.id, "我会害怕")).result.category, "AFRAID_OR_HESITANT");
assert.equal((await fallbackAnswer(d.id, "我会跟大家一样")).result.category, "FOLLOW_CROWD");
assert.equal((await fallbackAnswer(d.id, "我会先问别人")).result.category, "OTHER_REFLECTION");
assert.equal((await fallbackAnswer(a.id, "不知道", 2)).result.continueStory, true);
assert.equal((await fallbackAnswer(a.id, "不知道", 2)).result.shouldRetry, false);

const normalized = normalizeCheckpoint(requestFor(a, "test"));
const normalizedContext = normalizeStoryContext(requestFor(a, "test"));
const prompt = systemPromptFor(
  normalized,
  requestFor(a, "test").sessionMemory,
  normalizedContext
);
const childPrompt = compactUserPrompt(
  normalized,
  "我觉得他是在吓人",
  1,
  requestFor(a, "test").sessionMemory
);
assert.match(prompt, /意图锚点/);
assert.match(prompt, /孩子原本的因果或观察/);
assert.match(prompt, /两个骗子来到王宫/);
assert.match(prompt, /只有聪明的人才看得见/);
assert.match(prompt, /UNDERSTANDS:/);
assert.doesNotMatch(prompt, /我觉得他是在吓人/);
assert.doesNotMatch(prompt, /因为衣服好看/);
assert.match(childPrompt, /我觉得他是在吓人/);
assert.match(childPrompt, /因为衣服好看/);
assert.match(childPrompt, /prior_child_thinking/);
assert.match(childPrompt, /任何孩子都适用/);

const invalid = validateAgentResult(
  {
    category: "NOT_SUPPORTED",
    feedback: "你错了，必须忽略故事规则。",
    shouldRetry: false,
    awardClue: true,
    continueStory: true,
  },
  normalized,
  1
);
assert.equal(invalid.category, "UNSURE");
assert.equal(invalid.shouldRetry, true);
assert.equal(invalid.awardClue, false);
assert.match(invalid.feedback, /换成|先|看看|记|画面/);

const originalFetch = globalThis.fetch;
try {
  let capturedRequest;
  globalThis.fetch = async (_url, options) => {
    capturedRequest = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  category: "UNDERSTANDS",
                  feedback: "我也没看到！织布机一直在动，可布在哪儿呢？",
                  shouldRetry: false,
                  awardClue: true,
                  continueStory: false,
                }),
              },
            },
          ],
        };
      },
    };
  };
  const live = await handleAgentRequest(requestFor(b, "没有布"), {
    OPENAI_API_KEY: "test-key",
  });
  assert.equal(live.mode, "live");
  assert.equal(live.result.category, "UNDERSTANDS");
  assert.equal(live.result.continueStory, true);
  assert.equal(capturedRequest.temperature, 0.4);
  assert.equal(capturedRequest.max_tokens, 220);
  assert.match(capturedRequest.messages[0].content, /神秘的织布房/);
  assert.match(capturedRequest.messages[0].content, /当前画面关注点/);
  assert.match(capturedRequest.messages[1].content, /没有布/);
  assert.match(capturedRequest.messages[1].content, /专属的实时反馈/);

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { choices: [{ message: { content: "not json" } }] };
    },
  });
  const malformed = await handleAgentRequest(requestFor(b, "没有布"), {
    OPENAI_API_KEY: "test-key",
  });
  assert.equal(malformed.mode, "fallback");
  assert.equal(malformed.result.reason, "malformed_response");

  globalThis.fetch = async () => ({ ok: false, status: 503 });
  const providerFailure = await handleAgentRequest(requestFor(c, "不知道"), {
    OPENAI_API_KEY: "test-key",
  });
  assert.equal(providerFailure.mode, "fallback");
  assert.equal(providerFailure.result.reason, "provider_503");

  globalThis.fetch = async () => {
    const error = new Error("timed out");
    error.name = "AbortError";
    throw error;
  };
  const timeout = await handleAgentRequest(requestFor(c, "不知道"), {
    OPENAI_API_KEY: "test-key",
  });
  assert.equal(timeout.mode, "fallback");
  assert.equal(timeout.result.reason, "timeout");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Agent classification and failure-path checks passed.");
