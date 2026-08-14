(function () {
  const story = globalThis.EAZO_STORY;
  const audioManifest = globalThis.EAZO_AUDIO_MANIFEST || {};
  const app = document.getElementById("app");
  const STORAGE_KEY = "eazo-emperor-story-unit-reader-v3";
  const STAGE_RATIO = "1672 / 941";
  const TRANSITION_MS = 380;
  const approvedPageImages = {
    entry: "/assets/story-pages-16-9/cover.png",
    wardrobe: "/assets/story-pages-16-9/page-1.png",
    scammers: "/assets/story-pages-16-9/page-2.png",
    weaving: "/assets/story-pages-16-9/page-3.png",
    mirror: "/assets/story-pages-16-9/page-4.png",
    parade: "/assets/story-pages-16-9/page-5.png",
    truth: "/assets/story-pages-16-9/page-6.png",
  };
  const guideImages = {
    neutral: "/assets/guide/fairy-guide-neutral.png",
    positive: "/assets/guide/fairy-guide-positive.png",
  };
  const audioAssets = {
    bgm: "/assets/audio/bgm-global.mp3",
  };
  const BGM_VOLUME = 0.14;
  const BGM_DUCKED_VOLUME = 0.055;
  const BGM_LOOP_GAP_MS = 2000;
  const UNIT_AUDIO_DELAY_MS = 80;
  const MAX_RECORDING_MS = 15000;
  const preloadedAssets = new Set();

  if (!story || !app) {
    throw new Error("Storybook failed to load story data.");
  }

  let state = loadState();
  let transitionDirection = "";
  let transitionLockedUntil = 0;
  let resetModalOpen = false;
  let bgmAudio = null;
  let bgmLoopTimer = 0;
  let bgmDucked = false;
  let scheduledUnitAudioTimer = 0;
  let scheduledSpeechTimer = 0;
  let scheduledCheckpointTimer = 0;
  let currentSpeechAudio = null;
  let currentSpeechUtterance = null;
  let speechOutputActive = false;
  let activeSpeechToken = 0;
  let voiceState = defaultVoiceState();
  let fullSceneReaderOpen = false;
  let activatedUnitKey = "";
  const audioAvailabilityCache = new Map();

  function defaultState() {
    return {
      version: 3,
      currentSceneIndex: 0,
      currentUnitIndex: 0,
      sound: true,
      completed: {},
      clues: [],
      pages: {},
      activeClue: null,
      finished: false,
    };
  }

  function defaultVoiceState() {
    return {
      status: "idle",
      pageId: "",
      checkpointId: "",
      transcript: "",
      error: "",
      requestToken: 0,
      stream: null,
      recorder: null,
      recognition: null,
      recognitionTranscript: "",
      recognitionOnly: false,
      chunks: [],
      timer: 0,
      mimeType: "",
      shouldTranscribe: false,
    };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || parsed.version !== 3) return defaultState();
      const loaded = {
        ...defaultState(),
        ...parsed,
        completed: parsed.completed || {},
        pages: parsed.pages || {},
        clues: (parsed.clues || []).filter((clueId) =>
          (story.clues || []).some((clue) => clue.id === clueId)
        ),
      };
      loaded.currentSceneIndex = clampSceneIndex(loaded.currentSceneIndex);
      loaded.currentUnitIndex = clampUnitIndex(
        loaded.currentUnitIndex,
        loaded.currentSceneIndex
      );
      return loaded;
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function pageState(id) {
    if (!state.pages[id]) state.pages[id] = {};
    return state.pages[id];
  }

  function sceneUnits(page) {
    return page && Array.isArray(page.units) && page.units.length
      ? page.units
      : [{ type: "narration", text: page ? page.narrationText || page.title : "", audioSrc: null }];
  }

  function clampSceneIndex(index) {
    const maxIndex = Math.max(0, story.pages.length - 1);
    return Math.max(0, Math.min(maxIndex, Number(index) || 0));
  }

  function clampUnitIndex(index, sceneIndex = state.currentSceneIndex) {
    const page = story.pages[clampSceneIndex(sceneIndex)] || story.pages[0];
    const maxIndex = Math.max(0, sceneUnits(page).length - 1);
    return Math.max(0, Math.min(maxIndex, Number(index) || 0));
  }

  function currentPage() {
    return story.pages[state.currentSceneIndex] || story.pages[0];
  }

  function currentUnit() {
    return sceneUnits(currentPage())[state.currentUnitIndex] || sceneUnits(currentPage())[0];
  }

  function unitAt(sceneIndex, unitIndex) {
    const page = story.pages[clampSceneIndex(sceneIndex)];
    return sceneUnits(page)[clampUnitIndex(unitIndex, sceneIndex)] || null;
  }

  function currentUnitKey() {
    const page = currentPage();
    return `${page.id}:${state.currentUnitIndex}`;
  }

  function checkpointForPage(page) {
    if (!page || !page.checkpointId) return null;
    return story.checkpoints.find((checkpoint) => checkpoint.id === page.checkpointId) || null;
  }

  function checkpointFor(page, unit = currentUnit()) {
    if (!page || !unit || unit.type !== "question" || !unit.checkpointId) return null;
    return story.checkpoints.find((checkpoint) => checkpoint.id === unit.checkpointId) || null;
  }

  function checkpointStateFor(ps, checkpoint) {
    if (!ps.checkpoint || ps.checkpoint.id !== checkpoint.id) {
      ps.checkpoint = {
        id: checkpoint.id,
        status: "QUESTION",
        attempts: 0,
        answer: "",
        result: null,
        error: "",
        requestToken: 0,
      };
    }
    return ps.checkpoint;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function sceneAssetFor(page, ps = null) {
    if (page && page.type === "mirror" && ps && ps.mirrorRevealed && page.revealImage) {
      return page.revealImage;
    }
    return approvedPageImages[page.id] || page.image;
  }

  function markComplete(page) {
    const ps = pageState(page.id);
    ps.complete = true;
    state.completed[page.id] = true;
  }

  function recordPageCompletion(page) {
    markComplete(page);
    const ps = pageState(page.id);
    const checkpoint = checkpointForPage(page);
    const result = checkpoint && ps.checkpoint && ps.checkpoint.result;
    const shouldAwardCheckpointClue =
      result &&
      (result.awardClue ||
        (result.continueStory &&
          result.shouldRetry === false &&
          checkpoint.cluePolicy &&
          checkpoint.cluePolicy.afterMaxAttempts));
    const clueId = checkpoint
      ? shouldAwardCheckpointClue
        ? checkpoint.clueId
        : ""
      : page.clue && page.clue.id;
    const clue = checkpoint
      ? (clueId && (story.clues || []).find((item) => item.id === clueId)) || null
      : page.clue;

    if (clue && !state.clues.includes(clue.id)) {
      state.clues.push(clue.id);
      state.activeClue = clue;
    }
  }

  function pageInteractionReady() {
    return true;
  }

  function voiceInputSupported() {
    return Boolean(
      window.isSecureContext &&
        (browserSpeechRecognitionSupported() ||
          (navigator.mediaDevices &&
            navigator.mediaDevices.getUserMedia &&
            window.MediaRecorder))
    );
  }

  function browserSpeechRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function browserSpeechRecognitionSupported() {
    return Boolean(browserSpeechRecognitionCtor());
  }

  function preferredAudioMimeType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    return [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ].find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function currentVoiceScopedTo(page, checkpoint) {
    return (
      page &&
      checkpoint &&
      voiceState.pageId === page.id &&
      voiceState.checkpointId === checkpoint.id
    );
  }

  function clearVoiceTimer() {
    if (voiceState.timer) {
      window.clearTimeout(voiceState.timer);
      voiceState.timer = 0;
    }
  }

  function cleanupVoiceResources() {
    clearVoiceTimer();
    if (voiceState.recorder && voiceState.recorder.state !== "inactive") {
      try {
        voiceState.shouldTranscribe = false;
        voiceState.recorder.stop();
      } catch {
        // MediaRecorder may already be stopping.
      }
    }
    if (voiceState.stream) {
      voiceState.stream.getTracks().forEach((track) => track.stop());
    }
    voiceState.stream = null;
    voiceState.recorder = null;
    if (voiceState.recognition) {
      try {
        voiceState.recognition.onend = null;
        voiceState.recognition.onerror = null;
        voiceState.recognition.onresult = null;
        voiceState.recognition.stop();
      } catch {
        // Browser recognition may already be stopped.
      }
    }
    voiceState.recognition = null;
    voiceState.recognitionTranscript = "";
    voiceState.recognitionOnly = false;
    voiceState.chunks = [];
    setBgmDucked(false);
  }

  function resetVoiceState() {
    cleanupVoiceResources();
    voiceState = {
      ...defaultVoiceState(),
      requestToken: voiceState.requestToken + 1,
    };
  }

  function scopeVoiceState(page, checkpoint) {
    if (!page || !checkpoint) return;
    if (currentVoiceScopedTo(page, checkpoint)) return;
    resetVoiceState();
    voiceState.pageId = page.id;
    voiceState.checkpointId = checkpoint.id;
  }

  function isTransitionLocked() {
    return Date.now() < transitionLockedUntil;
  }

  function lockTransition(direction) {
    transitionDirection = direction || "";
    transitionLockedUntil = Date.now() + TRANSITION_MS;
    window.setTimeout(() => {
      if (!isTransitionLocked()) {
        transitionDirection = "";
        render();
      }
    }, TRANSITION_MS + 20);
  }

  function lastUnitIndexFor(sceneIndex) {
    const page = story.pages[clampSceneIndex(sceneIndex)];
    return Math.max(0, sceneUnits(page).length - 1);
  }

  function navigationBlocked() {
    return isTransitionLocked() || resetModalOpen || fullSceneReaderOpen;
  }

  function stopUnitActivity() {
    clearScheduledUnitAudio();
    resetVoiceState();
    stopSpeech();
  }

  function clearScheduledUnitAudio() {
    if (scheduledUnitAudioTimer) {
      window.clearTimeout(scheduledUnitAudioTimer);
      scheduledUnitAudioTimer = 0;
    }
  }

  function moveToNextUnit() {
    const page = currentPage();
    const units = sceneUnits(page);
    stopUnitActivity();
    state.finished = false;

    if (state.currentUnitIndex < units.length - 1) {
      state.currentUnitIndex += 1;
    } else if (state.currentSceneIndex < story.pages.length - 1) {
      recordPageCompletion(page);
      state.currentSceneIndex += 1;
      state.currentUnitIndex = 0;
      lockTransition("forward");
    } else {
      recordPageCompletion(page);
      state.finished = true;
      transitionDirection = "";
      transitionLockedUntil = 0;
    }

    saveState();
    render();
    activateCurrentUnit({ force: true });
  }

  function finishCheckpoint(page) {
    const checkpoint = checkpointFor(page);
    const ps = pageState(page.id);
    const checkpointState = checkpoint && ps.checkpoint;
    if (
      !checkpoint ||
      !checkpointState ||
      !checkpointState.result ||
      checkpointState.result.shouldRetry ||
      checkpointState.status === "ANALYZING"
    ) {
      return false;
    }

    if (checkpointState.status !== "DONE") {
      checkpointState.status = "DONE";
      recordPageCompletion(page);
      saveState();
    }

    if (state.activeClue) {
      render();
      speakGuide(currentGuideSpeechText());
      return true;
    }

    return false;
  }

  function canGoToPreviousUnit() {
    return !navigationBlocked() && !state.activeClue && state.currentUnitIndex > 0;
  }

  function currentQuestionCanAdvance(checkpointState) {
    if (!checkpointState) return false;
    if (checkpointState.status === "DONE") return true;
    return Boolean(
      checkpointState.status === "FEEDBACK" &&
        checkpointState.result &&
        checkpointState.result.continueStory
    );
  }

  function canGoToNextUnit(checkpointState) {
    if (navigationBlocked() || state.finished) return false;
    if (state.activeClue) return true;
    const unit = currentUnit();
    if (unit && unit.type === "question") return currentQuestionCanAdvance(checkpointState);
    return true;
  }

  function goToNextUnit() {
    if (navigationBlocked() || state.finished) return;

    const page = currentPage();
    const unit = currentUnit();
    const checkpoint = checkpointFor(page, unit);
    const checkpointState = checkpoint && pageState(page.id).checkpoint;

    if (state.activeClue) {
      state.activeClue = null;
      moveToNextUnit();
      return;
    }

    if (unit && unit.type === "question") {
      if (!checkpoint || !checkpointState) return;
      if (!currentQuestionCanAdvance(checkpointState)) return;
      if (checkpointState.status === "FEEDBACK") {
        stopUnitActivity();
        if (finishCheckpoint(page)) return;
      }
    }

    moveToNextUnit();
  }

  function goToPreviousUnit() {
    if (!canGoToPreviousUnit()) return;
    stopUnitActivity();
    state.finished = false;
    state.currentUnitIndex -= 1;
    saveState();
    render();
    activateCurrentUnit({ force: true });
  }

  function goToPreviousScene() {
    if (navigationBlocked() || state.currentSceneIndex === 0) return;
    stopUnitActivity();
    state.activeClue = null;
    state.finished = false;
    state.currentSceneIndex -= 1;
    state.currentUnitIndex = lastUnitIndexFor(state.currentSceneIndex);
    lockTransition("backward");
    saveState();
    render();
    activateCurrentUnit({ force: true });
  }

  function continueStory() {
    goToNextUnit();
  }

  function goBack() {
    goToPreviousScene();
  }

  function activateCurrentUnit(options = {}) {
    const page = currentPage();
    const unit = currentUnit();
    const unitKey = currentUnitKey();

    if (!options.force && activatedUnitKey === unitKey) return;
    activatedUnitKey = unitKey;
    clearScheduledUnitAudio();

    if (resetModalOpen || state.finished) return;

    if (state.activeClue) {
      if (options.speakClue !== false) {
        speakGuide(currentGuideSpeechText());
      }
      return;
    }

    const checkpoint = checkpointFor(page, unit);
    if (unit && unit.type === "question" && checkpoint) {
      const ps = pageState(page.id);
      const checkpointState = checkpointStateFor(ps, checkpoint);
      scopeVoiceState(page, checkpoint);
      if (checkpointState.status === "QUESTION") {
        checkpointState.error = "";
        saveState();
        render();
        speakGuide(checkpoint.question);
      }
      return;
    }

    if (!unit || unit.type === "question") return;

    const spokenText = storyContextUnitText(unit);
    if (!spokenText) return;
    const audioPath = unit.audioSrc || "";
    scheduledUnitAudioTimer = window.setTimeout(() => {
      scheduledUnitAudioTimer = 0;
      if (currentUnitKey() !== unitKey || navigationBlocked() || state.activeClue || state.finished) return;
      playStaticSpeech(audioPath, spokenText, "narrator");
    }, UNIT_AUDIO_DELAY_MS);
  }

  function requestReset() {
    stopUnitActivity();
    resetModalOpen = true;
    render();
  }

  function cancelReset() {
    resetModalOpen = false;
    render();
  }

  function confirmReset() {
    clearScheduledUnitAudio();
    resetVoiceState();
    stopSpeech();
    const soundPreference = state.sound;
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    state.sound = soundPreference;
    resetModalOpen = false;
    fullSceneReaderOpen = false;
    activatedUnitKey = "";
    transitionDirection = "";
    transitionLockedUntil = 0;
    render();
    activateCurrentUnit({ force: true });
    startBgm();
  }

  function toggleSound() {
    state.sound = !state.sound;
    saveState();
    if (!state.sound) {
      stopAllAudio();
    } else {
      startBgm();
    }
    render();
  }

  function preloadImage(src) {
    if (!src || preloadedAssets.has(src)) return;
    const img = new Image();
    img.src = src;
    preloadedAssets.add(src);
  }

  function preloadSceneAsset(index) {
    const page = story.pages[index];
    if (!page) return;
    preloadImage(sceneAssetFor(page));
  }

  function preloadGuideAssets() {
    Object.values(guideImages).forEach(preloadImage);
  }

  function preloadAudioAssets() {
    const page = currentPage();
    const unit = currentUnit();
    if (!preloadedAssets.has(audioAssets.bgm)) {
      getBgmAudio();
      preloadedAssets.add(audioAssets.bgm);
    }
    if (unit && unit.audioSrc) preloadStaticAudio(unit.audioSrc);
    const nextUnit = unitAt(state.currentSceneIndex, state.currentUnitIndex + 1);
    if (nextUnit && nextUnit.audioSrc) preloadStaticAudio(nextUnit.audioSrc);
    const checkpoint = checkpointFor(page);
    if (checkpoint) preloadStaticAudio(guideAudioPathForText(checkpoint.question));
    if (state.activeClue) preloadStaticAudio(guideAudioPathForText(currentGuideSpeechText()));
  }

  function icon(name) {
    const paths = {
      back: '<path d="m15 18-6-6 6-6"></path>',
      next: '<path d="m9 18 6-6-6-6"></path>',
      book:
        '<path d="M12 7v14"></path><path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H12v18H5.5A2.5 2.5 0 0 1 3 18.5v-13Z"></path><path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H12v18h6.5A2.5 2.5 0 0 0 21 18.5v-13Z"></path>',
      reset:
        '<path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 3v6h6"></path>',
      sound:
        '<path d="M11 5 6 9H3v6h3l5 4V5Z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18 6a8 8 0 0 1 0 12"></path>',
      mute:
        '<path d="M11 5 6 9H3v6h3l5 4V5Z"></path><path d="m16 9 5 5"></path><path d="m21 9-5 5"></path>',
      mic:
        '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><path d="M12 19v3"></path>',
      stop: '<rect x="6" y="6" width="12" height="12" rx="2"></rect>',
    };
    return `
      <svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true">
        ${paths[name] || ""}
      </svg>
    `;
  }

  function controlButton(action, iconName, label, options = {}) {
    const disabled = options.disabled ? "disabled" : "";
    const pressed =
      options.pressed === undefined ? "" : `aria-pressed="${options.pressed ? "true" : "false"}"`;
    return `
      <button
        class="stage-button"
        type="button"
        data-action="${escapeHtml(action)}"
        data-no-stage-advance
        ${disabled}
        ${pressed}
        aria-label="${escapeHtml(label)}"
        title="${escapeHtml(label)}"
      >
        ${icon(iconName)}
      </button>
    `;
  }

  function textControlButton(action, iconName, label, options = {}) {
    const disabled = options.disabled ? "disabled" : "";
    return `
      <button
        class="stage-text-button"
        type="button"
        data-action="${escapeHtml(action)}"
        data-no-stage-advance
        ${disabled}
        aria-label="${escapeHtml(label)}"
        title="${escapeHtml(label)}"
      >
        ${icon(iconName)}
        <span>${escapeHtml(label)}</span>
      </button>
    `;
  }

  function unitNavButton(action, iconName, label, side, disabled) {
    return `
      <button
        class="unit-nav-button unit-nav-${escapeHtml(side)}"
        type="button"
        data-action="${escapeHtml(action)}"
        data-no-stage-advance
        ${disabled ? "disabled" : ""}
        aria-label="${escapeHtml(label)}"
        title="${escapeHtml(label)}"
      >
        ${icon(iconName)}
      </button>
    `;
  }

  function storyScenePages() {
    return story.pages.filter((page) => page.type !== "entry");
  }

  function progressDots() {
    const scenePages = storyScenePages();
    const activeStoryIndex = scenePages.findIndex((page) => page.id === currentPage().id);
    return scenePages
      .map((page, index) => {
        const classes = [
          "progress-dot",
          index === activeStoryIndex ? "is-active" : "",
          state.completed[page.id] ? "is-complete" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<span class="${classes}" aria-hidden="true"></span>`;
      })
      .join("");
  }

  function progressLabel() {
    const scenePages = storyScenePages();
    const activeStoryIndex = scenePages.findIndex((page) => page.id === currentPage().id);
    return activeStoryIndex < 0 ? "序章" : `${activeStoryIndex + 1} / ${scenePages.length}`;
  }

  function pageLabel(page) {
    const chapter = page.chapter || "";
    const title = page.title || story.metadata.title;
    return chapter ? `${chapter}: ${title}` : title;
  }

  function renderStoryTextPanel(page, unit) {
    if (!unit || unit.type === "question") return "";
    const isDialogue = unit.type === "dialogue";
    const text = unit.text || page.title || story.metadata.title;
    return `
      <aside class="story-text-panel guide-overlay" aria-live="polite">
        <article class="agent-card story-unit-card">
          ${isDialogue ? `<div class="story-text-speaker">${escapeHtml(unit.speaker || "角色")}</div>` : ""}
          <p class="story-text-line">${escapeHtml(text)}</p>
        </article>
      </aside>
    `;
  }

  function fullSceneLiteraryUnits(page) {
    return sceneUnits(page).filter((unit) => unit.type === "narration" || unit.type === "dialogue");
  }

  function renderFullSceneParagraph(unit, index) {
    const isDialogue = unit.type === "dialogue";
    const speaker = isDialogue ? `${unit.speaker || "角色"}：` : "";
    return `
      <p class="full-story-paragraph ${isDialogue ? "is-dialogue" : "is-narration"}">
        ${speaker ? `<strong>${escapeHtml(speaker)}</strong>` : ""}
        ${escapeHtml(unit.text || "")}
      </p>
    `;
  }

  function renderFullSceneOverlay(page) {
    if (!fullSceneReaderOpen) return "";
    const paragraphs = fullSceneLiteraryUnits(page)
      .map(renderFullSceneParagraph)
      .join("");
    return `
      <div class="full-story-backdrop" data-no-stage-advance>
        <section
          class="full-story-card"
          role="dialog"
          aria-modal="true"
          aria-label="查看本幕全文"
        >
          <button
            class="full-story-close"
            type="button"
            data-action="close-full-story"
            aria-label="关闭本幕全文"
            title="关闭"
          >
            ×
          </button>
          <div class="full-story-heading">
            <span>📖 本幕全文</span>
            <h2>${escapeHtml(page.title || page.chapter || story.metadata.title)}</h2>
          </div>
          <div class="full-story-body">
            ${paragraphs || `<p class="full-story-paragraph">${escapeHtml(page.title || story.metadata.title)}</p>`}
          </div>
        </section>
      </div>
    `;
  }

  function isPositiveGuideResult(result) {
    if (!result) return false;
    if (
      result.category === "SPEAK_TRUTH" ||
      result.category === "AFRAID_OR_HESITANT" ||
      result.category === "FOLLOW_CROWD" ||
      result.category === "OTHER_REFLECTION"
    ) {
      return false;
    }
    return result.awardClue || result.category === "UNDERSTANDS";
  }

  function guideVariantFor(checkpointState) {
    if (!checkpointState || !checkpointState.result) return "neutral";
    return isPositiveGuideResult(checkpointState.result) ? "positive" : "neutral";
  }

  function renderGuideFigure(variant = "neutral") {
    const src = guideImages[variant] || guideImages.neutral;
    return `
      <div class="guide-fairy-wrap" aria-hidden="true">
        <img
          class="guide-fairy is-${escapeHtml(variant)}"
          src="${escapeHtml(src)}"
          alt=""
          decoding="async"
        />
      </div>
    `;
  }

  function checkpointCategory(checkpoint, answer) {
    const input = String(answer || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (checkpoint.rubric.type === "reflection") {
      if (/说出来|告诉|提醒|说真话|揭穿|大声|实话/.test(input)) return "SPEAK_TRUTH";
      if (/害怕|不敢|担心|犹豫|紧张/.test(input)) return "AFRAID_OR_HESITANT";
      if (/跟大家|跟着|装作|一起说|随大流|不想被笑/.test(input)) return "FOLLOW_CROWD";
      return "OTHER_REFLECTION";
    }
    if (!input || /不知道|不确定|不清楚|没想好|说不清/.test(input)) return "UNSURE";
    if (checkpoint.id === "checkpoint-wardrobe-motivation") {
      if (/喜欢漂亮|爱漂亮|在意.*衣|别人.*觉得|显得|帅|威风|特别|外表/.test(input)) {
        return "UNDERSTANDS";
      }
      if (/衣服好看|皇帝|想换|很多衣服|新衣服/.test(input)) return "PARTIAL";
    }
    if (checkpoint.id === "checkpoint-suspicious-wording") {
      if (/有点奇怪|好像奇怪|不太对|怪怪/.test(input)) return "PARTIAL";
      if (/聪明的人才能看|聪明.*才能.*看|只有聪明.*看/.test(input)) {
        return "MISUNDERSTANDS";
      }
      if (/奇怪|骗人|骗|压力|吓|聪明.*看|看不见.*聪明|可疑|不应该/.test(input)) {
        return "UNDERSTANDS";
      }
      if (/有点|好像|为什么|不太对|怪怪/.test(input)) return "PARTIAL";
      if (/真的|相信|厉害|一定能看|神奇/.test(input)) return "MISUNDERSTANDS";
    }
    if (checkpoint.id === "checkpoint-empty-loom") {
      if (/透明|可能.*有布|真的有|看见布|出现了布/.test(input)) return "MISUNDERSTANDS";
      if (/好像.*没有|可能.*没有|看起来.*没有|似乎.*没有/.test(input)) return "PARTIAL";
      if (/没有布|没布|空空|没有看见|看不到|不见|没有出现|没有|没出现/.test(input)) {
        return "UNDERSTANDS";
      }
    }
    if (checkpoint.id === "checkpoint-mirror-truth") {
      if (/怕|害怕|不敢|担心|怕.*聪明|不想.*笨|不想.*不称职/.test(input)) {
        return "UNDERSTANDS";
      }
      if (/没看见|没有看见|看不见|没看到|没有看到|什么也没|没有衣服|没穿|内裤/.test(input)) {
        return "PARTIAL";
      }
      if (/怪|不对|奇怪|装|假装/.test(input)) return "PARTIAL";
      if (/看到了|看到.*衣|真的有|漂亮|合身|喜欢|满意/.test(input)) return "MISUNDERSTANDS";
    }
    if (checkpoint.id === "checkpoint-parade-conformity") {
      if (/不一定|未必|跟着|从众|害怕|不敢|别人说|装|没看见|没有都/.test(input)) {
        return "UNDERSTANDS";
      }
      if (/都看到了|都看见了|全都看见|大家说所以是真的|真的都看见/.test(input)) {
        return "MISUNDERSTANDS";
      }
      if (/有些|可能|也许|不太确定/.test(input)) return "PARTIAL";
    }
    if (/颜色|红色|蓝色|天气|游戏/.test(input)) return "OFF_TOPIC";
    return "UNSURE";
  }

  function fallbackFeedbackFor(checkpoint, category, answer, attempt) {
    const input = String(answer || "");
    if (checkpoint.rubric.type === "reflection") {
      if (category === "SPEAK_TRUTH") return "“皇帝根本没穿衣服！”你会这样说呀。";
      if (category === "AFRAID_OR_HESITANT") {
        return "嗯，我懂。周围所有人都在说“好漂亮”，这时候开口确实有点难。";
      }
      if (category === "FOLLOW_CROWD") {
        return "你可能也会先看看大家怎么说。其实故事里好多大人也是这样。";
      }
      return "嗯……那你觉得，故事里的那个孩子为什么敢说出来？";
    }

    if (checkpoint.id === "checkpoint-wardrobe-motivation") {
      if (category === "UNDERSTANDS") return "嗯，他好像真的很在意新衣服。";
      if (category === "PARTIAL") {
        return "嗯……好看是一回事。你看这一屋子的衣服，他是不是有点太在意啦？";
      }
      return "那我们先不急。看看这一屋子的衣服和皇冠，说不定等下就知道了。";
    }

    if (checkpoint.id === "checkpoint-suspicious-wording") {
      if (category === "UNDERSTANDS") {
        return "看不见，就要被人说不聪明？这话听着可真怪。先记下来。";
      }
      if (category === "MISUNDERSTANDS") {
        return "那我们继续看看，他们能不能织出这件衣服吧。。";
      }
    }

    if (checkpoint.id === "checkpoint-empty-loom") {
      if (category === "UNDERSTANDS") {
        return "我也没看到……织布机一直在动，可布在哪儿呢？这个得记下来。";
      }
      if (attempt >= checkpoint.maxAttempts) return checkpoint.retryGuidance.exhausted;
      if (category === "MISUNDERSTANDS") {
        return "透明的？嗯……那我们找找看，有没有什么证据。";
      }
    }

    if (checkpoint.id === "checkpoint-mirror-truth") {
      if (category === "UNDERSTANDS" && /怕|害怕|不敢|担心|聪明/.test(input)) {
        return "嗯，他好像怕别人觉得自己不聪明。";
      }
      if (category === "UNDERSTANDS") {
        return "我也在想这个！他明明什么都没看见，怎么就是不肯说呢？";
      }
      if (category === "MISUNDERSTANDS") {
        return "先记着这个奇怪的地方。我们去看看其他人会不会也这样。";
      }
    }

    if (checkpoint.id === "checkpoint-parade-conformity") {
      if (category === "UNDERSTANDS") {
        return "嗯……可能大家都在等别人先说真话。";
      }
      if (category === "MISUNDERSTANDS") {
        return "可是我们刚才看到的织布机，明明是空的呀？";
      }
    }

    if (attempt >= checkpoint.maxAttempts && checkpoint.retryGuidance.exhausted) {
      return checkpoint.retryGuidance.exhausted;
    }
    if (checkpoint.retryGuidance.first) return checkpoint.retryGuidance.first;
    return checkpoint.authoredFallback.feedback;
  }

  function fallbackCheckpointResult(checkpoint, answer, attempt, reason) {
    const categories = Object.keys(checkpoint.rubric.categories || {});
    const category = categories.includes(checkpointCategory(checkpoint, answer))
      ? checkpointCategory(checkpoint, answer)
      : checkpoint.rubric.type === "reflection"
        ? "OTHER_REFLECTION"
        : "UNSURE";
    const isReflection = checkpoint.rubric.type === "reflection";
    const understood = isReflection || category === "UNDERSTANDS";
    const shouldRetry = !isReflection && !understood && attempt < checkpoint.maxAttempts;
    const feedback = fallbackFeedbackFor(checkpoint, category, answer, attempt);

    return {
      category,
      feedback,
      shouldRetry,
      awardClue: !isReflection && understood && Boolean(checkpoint.clueId),
      continueStory: !shouldRetry,
      reason,
    };
  }

  function normalizeCheckpointResult(raw, checkpoint, attempt) {
    const fallback = fallbackCheckpointResult(checkpoint, "", attempt, "invalid_response");
    const candidate = raw && typeof raw === "object" ? raw.result || raw : {};
    const categories = Object.keys(checkpoint.rubric.categories || {});
    const category = categories.includes(candidate.category) ? candidate.category : fallback.category;
    const isReflection = checkpoint.rubric.type === "reflection";
    const understood = isReflection || category === "UNDERSTANDS";
    const shouldRetry = !isReflection && !understood && attempt < checkpoint.maxAttempts;
    const feedback = String(candidate.feedback || "").replace(/\s+/g, " ").trim().slice(0, 180);
    return {
      category,
      feedback: feedback || fallback.feedback,
      shouldRetry,
      awardClue: !isReflection && understood && Boolean(checkpoint.clueId),
      continueStory: !shouldRetry,
    };
  }

  async function requestCheckpointResult(checkpoint, answer, attempt) {
    const fallback = fallbackCheckpointResult(checkpoint, answer, attempt, "endpoint_unavailable");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8500);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          role: "guide",
          checkpointId: checkpoint.id,
          question: checkpoint.question,
          educationalGoal: checkpoint.educationalGoal,
          rubric: checkpoint.rubric,
          maxAttempts: checkpoint.maxAttempts,
          clueId: checkpoint.clueId || "",
          retryGuidance: checkpoint.retryGuidance,
          storyContext: storyContextForAgent(currentPage(), checkpoint),
          sessionMemory: sessionMemoryForAgent(checkpoint.id),
          childAnswer: answer,
          attempt,
        }),
      });
      if (!response.ok) return fallback;
      const json = await response.json();
      return normalizeCheckpointResult(json, checkpoint, attempt);
    } catch {
      return fallback;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function storyContextUnitText(unit) {
    if (!unit) return "";
    if (unit.type === "dialogue") {
      return `${unit.speaker || "角色"}：“${unit.text || ""}”`;
    }
    return unit.type === "narration" ? unit.text || "" : "";
  }

  function storyContextForAgent(page, checkpoint) {
    const units = sceneUnits(page);
    const questionIndex = units.findIndex(
      (unit) => unit.type === "question" && unit.checkpointId === checkpoint.id
    );
    const excerptEnd = questionIndex >= 0 ? questionIndex : units.length;
    const sceneExcerpt = units
      .slice(0, excerptEnd)
      .map(storyContextUnitText)
      .filter(Boolean)
      .slice(-5)
      .join(" ");

    return {
      pageId: page.id,
      title: page.title || "",
      chapter: page.chapter || "",
      guide: page.guide || "",
      guideReaction: page.guideReaction || "",
      sceneExcerpt,
    };
  }

  function sessionMemoryForAgent(currentCheckpointId = "") {
    const acquiredClues = (story.clues || [])
      .filter((clue) => state.clues.includes(clue.id))
      .map((clue) => ({
        id: clue.id,
        title: clue.title,
        text: clue.text,
      }));
    const priorCheckpoints = story.pages
      .map((page) => state.pages[page.id] && state.pages[page.id].checkpoint)
      .filter(
        (checkpointState) =>
          checkpointState &&
          checkpointState.result &&
          checkpointState.id !== currentCheckpointId
      )
      .slice(-4)
      .map((checkpointState) => ({
        id: checkpointState.id,
        category: checkpointState.result.category,
        childAnswer: checkpointState.answer || "",
      }));
    return { acquiredClues, priorCheckpoints };
  }

  function voiceBusyBlocksSubmit() {
    return ["requesting", "recording", "transcribing"].includes(voiceState.status);
  }

  function setVoiceError(page, checkpoint, message) {
    scopeVoiceState(page, checkpoint);
    voiceState.requestToken += 1;
    cleanupVoiceResources();
    voiceState.status = "error";
    voiceState.error = message || "我没有听清楚。可以再说一次，或者打字。";
    voiceState.transcript = "";
    saveState();
    render();
  }

  function completeVoiceTranscript(transcript, token, pageId, checkpointId) {
    const text = String(transcript || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    if (
      !text ||
      voiceState.requestToken !== token ||
      currentPage().id !== pageId ||
      (checkpointFor(currentPage()) || {}).id !== checkpointId
    ) {
      return false;
    }

    cleanupVoiceResources();
    voiceState.status = "ready";
    voiceState.pageId = pageId;
    voiceState.checkpointId = checkpointId;
    voiceState.error = "";
    voiceState.transcript = text;
    voiceState.requestToken = token;
    render();
    const input = app.querySelector("[data-answer-input]");
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    return true;
  }

  function startBrowserSpeechRecognition(page, checkpoint, token) {
    const Recognition = browserSpeechRecognitionCtor();
    if (!Recognition) return false;

    try {
      const recognition = new Recognition();
      recognition.lang = "zh-CN";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      voiceState.recognition = recognition;
      voiceState.recognitionTranscript = "";

      recognition.onresult = (event) => {
        let transcript = "";
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          transcript += result && result[0] ? result[0].transcript : "";
        }
        voiceState.recognitionTranscript = transcript
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180);
      };

      recognition.onerror = (event) => {
        if (voiceState.requestToken !== token || !voiceState.recognitionOnly) return;
        const denied = event && (event.error === "not-allowed" || event.error === "service-not-allowed");
        setVoiceError(
          page,
          checkpoint,
          denied ? "麦克风没有打开。可以允许麦克风，或者先打字。" : "这次没听清。可以再录一次，或者直接打字。"
        );
      };

      recognition.onend = () => {
        if (voiceState.requestToken !== token || !voiceState.recognitionOnly) return;
        if (completeVoiceTranscript(voiceState.recognitionTranscript, token, page.id, checkpoint.id)) return;
        setVoiceError(page, checkpoint, "我没有听清楚。可以再说一次，或者打字。");
      };

      recognition.start();
      return true;
    } catch {
      voiceState.recognition = null;
      voiceState.recognitionTranscript = "";
      return false;
    }
  }

  async function transcribeVoiceBlob(blob, token, pageId, checkpointId) {
    if (!blob || !blob.size) {
      if (voiceState.requestToken === token) {
        setVoiceError(currentPage(), checkpointFor(currentPage()), "我没有听清楚。可以再说一次，或者打字。");
      }
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 22000);
    try {
      const body = new FormData();
      const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      body.append("audio", blob, `answer.${extension}`);
      body.append("language", "zh");

      const response = await fetch("/api/transcribe", {
        method: "POST",
        signal: controller.signal,
        body,
      });
      const json = response.ok ? await response.json() : null;
      const transcript = String((json && json.transcript) || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);

      if (
        voiceState.requestToken !== token ||
        currentPage().id !== pageId ||
        (checkpointFor(currentPage()) || {}).id !== checkpointId
      ) {
        return;
      }

      if (!json || !json.ok || !transcript) {
        voiceState.status = "error";
        voiceState.error =
          (json && json.message) || "我没有听清楚。可以再说一次，或者打字。";
        voiceState.transcript = "";
        render();
        return;
      }

      voiceState.status = "ready";
      voiceState.error = "";
      voiceState.transcript = transcript;
      render();
      const input = app.querySelector("[data-answer-input]");
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    } catch (error) {
      if (voiceState.requestToken !== token) return;
      voiceState.status = "error";
      voiceState.error =
        error && error.name === "AbortError"
          ? "等太久啦。可以再录一次，或者直接打字。"
          : "这次没听清。可以再录一次，或者直接打字。";
      voiceState.transcript = "";
      render();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function startVoiceRecording(page, checkpoint) {
    if (!page || !checkpoint || ["requesting", "recording", "transcribing"].includes(voiceState.status)) {
      return;
    }
    scopeVoiceState(page, checkpoint);

    if (!voiceInputSupported()) {
      setVoiceError(page, checkpoint, "这个浏览器暂时不能录音，可以直接打字。");
      return;
    }

    if (speechOutputActive) {
      setVoiceError(page, checkpoint, "先等声音播放完，再用麦克风。");
      return;
    }

    stopSpeech();
    voiceState.status = "requesting";
    voiceState.error = "";
    voiceState.transcript = "";
    voiceState.requestToken += 1;
    const token = voiceState.requestToken;
    saveState();
    render();

    if (browserSpeechRecognitionSupported()) {
      voiceState.recognitionOnly = true;
      voiceState.status = "recording";
      voiceState.timer = window.setTimeout(() => stopVoiceRecording(), MAX_RECORDING_MS);
      setBgmDucked(true);
      if (startBrowserSpeechRecognition(page, checkpoint, token)) {
        render();
        return;
      }
      clearVoiceTimer();
      voiceState.recognitionOnly = false;
      setBgmDucked(false);
      voiceState.status = "requesting";
      render();
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      setVoiceError(page, checkpoint, "这个浏览器暂时不能录音，可以直接打字。");
      return;
    }

    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (voiceState.requestToken !== token || currentPage().id !== page.id) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const mimeType = preferredAudioMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      voiceState.stream = stream;
      voiceState.recorder = recorder;
      voiceState.chunks = [];
      voiceState.mimeType = recorder.mimeType || mimeType || "audio/webm";
      voiceState.shouldTranscribe = true;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size) voiceState.chunks.push(event.data);
      });
      recorder.addEventListener("error", () => {
        if (voiceState.requestToken === token) {
          setVoiceError(page, checkpoint, "录音出了一点问题，可以再试一次，或者打字。");
        }
      });
      recorder.addEventListener("stop", () => {
        const shouldTranscribe = voiceState.shouldTranscribe;
        const chunks = voiceState.chunks.slice();
        clearVoiceTimer();
        stream.getTracks().forEach((track) => track.stop());
        setBgmDucked(false);

        if (voiceState.requestToken !== token) return;
        voiceState.stream = null;
        voiceState.recorder = null;
        voiceState.chunks = [];

        if (!shouldTranscribe) {
          voiceState.status = "idle";
          render();
          return;
        }

        voiceState.status = "transcribing";
        render();
        const blob = new Blob(chunks, { type: voiceState.mimeType || "audio/webm" });
        transcribeVoiceBlob(blob, token, page.id, checkpoint.id);
      });

      recorder.start();
      voiceState.status = "recording";
      voiceState.timer = window.setTimeout(() => stopVoiceRecording(), MAX_RECORDING_MS);
      setBgmDucked(true);
      render();
    } catch (error) {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (voiceState.requestToken !== token) return;
      const denied = error && (error.name === "NotAllowedError" || error.name === "SecurityError");
      setVoiceError(
        page,
        checkpoint,
        denied ? "麦克风没有打开。可以允许麦克风，或者先打字。" : "这里暂时录不了音，可以直接打字。"
      );
    }
  }

  function stopVoiceRecording(options = {}) {
    const transcribe = options.transcribe !== false;
    if (!["requesting", "recording"].includes(voiceState.status)) return;
    voiceState.shouldTranscribe = transcribe;
    clearVoiceTimer();

    if (voiceState.recognitionOnly) {
      if (!transcribe) {
        resetVoiceState();
        render();
        return;
      }
      voiceState.status = "transcribing";
      if (voiceState.recognition) {
        try {
          voiceState.recognition.stop();
        } catch {
          if (!completeVoiceTranscript(
            voiceState.recognitionTranscript,
            voiceState.requestToken,
            voiceState.pageId,
            voiceState.checkpointId
          )) {
            setVoiceError(currentPage(), checkpointFor(currentPage()), "我没有听清楚。可以再说一次，或者打字。");
          }
        }
      } else if (
        !completeVoiceTranscript(
          voiceState.recognitionTranscript,
          voiceState.requestToken,
          voiceState.pageId,
          voiceState.checkpointId
        )
      ) {
        setVoiceError(currentPage(), checkpointFor(currentPage()), "我没有听清楚。可以再说一次，或者打字。");
      }
      render();
      return;
    }

    if (voiceState.recorder && voiceState.recorder.state !== "inactive") {
      if (transcribe) voiceState.status = "transcribing";
      try {
        voiceState.recorder.stop();
      } catch {
        resetVoiceState();
      }
      render();
      return;
    }
    resetVoiceState();
    render();
  }

  async function submitCheckpointAnswer(page, checkpoint, answer) {
    const ps = pageState(page.id);
    const checkpointState = checkpointStateFor(ps, checkpoint);
    if (checkpointState.status === "ANALYZING" || checkpointState.attempts >= checkpoint.maxAttempts) {
      return;
    }

    resetVoiceState();
    checkpointState.attempts += 1;
    checkpointState.answer = answer;
    checkpointState.status = "ANALYZING";
    checkpointState.error = "";
    checkpointState.requestToken = Date.now();
    const requestToken = checkpointState.requestToken;
    const sceneIndex = state.currentSceneIndex;
    const unitIndex = state.currentUnitIndex;
    saveState();
    stopSpeech();
    render();

    const result = await requestCheckpointResult(checkpoint, answer, checkpointState.attempts);
    if (
      state.currentSceneIndex !== sceneIndex ||
      state.currentUnitIndex !== unitIndex ||
      checkpointState.requestToken !== requestToken ||
      checkpointState.status !== "ANALYZING"
    ) {
      return;
    }

    checkpointState.result = normalizeCheckpointResult(result, checkpoint, checkpointState.attempts);
    checkpointState.status = "FEEDBACK";
    saveState();
    render();
    speakGuide(checkpointState.result.feedback);
  }

  function canStageAdvance(page, checkpointState) {
    const ps = pageState(page.id);
    if (resetModalOpen || isTransitionLocked()) return false;
    if (state.activeClue) return true;
    if (ps.afterNarrationActive) return true;
    if (state.finished) return false;
    if (!checkpointFor(page)) return true;
    if (!checkpointState) return pageInteractionReady(page, ps);
    if (checkpointState.status === "DONE") return true;
    if (checkpointState.status === "FEEDBACK") {
      return Boolean(checkpointState.result && checkpointState.result.continueStory);
    }
    return false;
  }

  function renderAfterNarrationOverlay(page, ps) {
    if (!ps.afterNarrationActive || !page.narrationAfterInteraction) return "";
    return `
      <aside class="story-continue-overlay guide-overlay" aria-live="polite">
        <article class="agent-card story-continue-card">
          ${renderGuideFigure("neutral")}
          <div class="agent-kicker">故事继续</div>
          <h2>${escapeHtml(page.chapter || page.title || story.metadata.title)}</h2>
          <p class="agent-feedback">${escapeHtml(page.narrationAfterInteraction)}</p>
          <p class="agent-hint">点击继续</p>
        </article>
      </aside>
    `;
  }

  function voiceStatusFor(page, checkpoint) {
    if (!voiceInputSupported()) {
      return {
        status: "unsupported",
        message: "这个浏览器暂时不能录音，可以直接打字。",
      };
    }
    if (!currentVoiceScopedTo(page, checkpoint)) {
      return {
        status: "idle",
        message: "",
      };
    }
    if (voiceState.status === "requesting") {
      return { status: "requesting", message: "正在打开麦克风..." };
    }
    if (voiceState.status === "recording") {
      return { status: "recording", message: "正在听...说完点一下停止。" };
    }
    if (voiceState.status === "transcribing") {
      return { status: "transcribing", message: "正在把声音变成文字..." };
    }
    if (voiceState.status === "ready") {
      return {
        status: "ready",
        message: `听到：“${voiceState.transcript}” 可以改一改，再提交。`,
      };
    }
    if (voiceState.status === "error") {
      return {
        status: "error",
        message: voiceState.error || "我没有听清楚。可以再说一次，或者打字。",
      };
    }
    return {
      status: "idle",
      message: "",
    };
  }

  function renderVoiceControls(page, checkpoint, options = {}) {
    const stateForVoice = voiceStatusFor(page, checkpoint);
    const status = stateForVoice.status;
    const isRecording = status === "recording";
    const isBusy = status === "requesting" || status === "transcribing";
    const unsupported = status === "unsupported";
    const disabled =
      options.disabled ||
      unsupported ||
      isBusy ||
      (!isRecording && speechOutputActive);
    const action = isRecording ? "stop" : "start";
    const label = isRecording
      ? "停止录音"
      : status === "ready" || status === "error"
        ? "重新录音"
        : "用麦克风说";
    const text = isRecording
      ? "停止"
      : status === "ready" || status === "error"
        ? "重录"
        : "说话";
    return `
      <button
        class="voice-button is-${escapeHtml(status)}"
        type="button"
        data-voice-action="${escapeHtml(action)}"
        data-no-stage-advance
        ${disabled ? "disabled" : ""}
        aria-pressed="${isRecording ? "true" : "false"}"
        aria-label="${escapeHtml(label)}"
        title="${escapeHtml(label)}"
      >
        ${icon(isRecording ? "stop" : "mic")}
        <span>${escapeHtml(text)}</span>
      </button>
    `;
  }

  function renderVoiceStatus(page, checkpoint) {
    const stateForVoice = voiceStatusFor(page, checkpoint);
    if (!stateForVoice.message) return "";
    return `<p class="voice-status is-${escapeHtml(stateForVoice.status)}" data-voice-status>${escapeHtml(stateForVoice.message)}</p>`;
  }

  function renderAgentOverlay(page, checkpoint, checkpointState) {
    if (state.activeClue || state.finished || !checkpoint || !checkpointState) return "";
    if (checkpointState.status === "DONE") return "";
    const result = checkpointState.result;
    const isAnalyzing = checkpointState.status === "ANALYZING";
    const canRetry = checkpointState.status === "FEEDBACK" && result && result.shouldRetry;
    const canContinue = checkpointState.status === "FEEDBACK" && result && result.continueStory;
    const scopedVoiceReady =
      currentVoiceScopedTo(page, checkpoint) && voiceState.status === "ready" && voiceState.transcript;
    const inputValue = scopedVoiceReady ? voiceState.transcript : canRetry ? "" : checkpointState.answer || "";
    const isFeedback = checkpointState.status === "FEEDBACK" && result;
    const guideVariant = guideVariantFor(checkpointState);
    const heading = isFeedback
      ? canRetry
        ? "再看一眼"
        : isPositiveGuideResult(result)
          ? "先记下来"
          : "精灵小助手"
      : checkpoint.question;

    const blockStageAdvance = canRetry || isAnalyzing || !result;
    return `
      <aside
        class="agent-overlay guide-overlay is-${escapeHtml(guideVariant)} ${isAnalyzing ? "is-waiting" : ""}"
        aria-live="polite"
        ${blockStageAdvance ? "data-no-stage-advance" : ""}
      >
        <article class="agent-card">
          ${renderGuideFigure(guideVariant)}
          <div class="agent-kicker">精灵小助手</div>
          <h2>${escapeHtml(heading)}</h2>
          ${result ? `<p class="agent-feedback">${escapeHtml(result.feedback)}</p>` : ""}
          ${
            isAnalyzing
              ? `<p class="agent-wait">精灵小助手正在听你的想法...</p>`
              : canContinue
                ? `<p class="agent-hint">点击任意处继续</p>`
                : `<form class="agent-form" data-checkpoint-form data-no-stage-advance>
                     <div class="answer-input-wrap">
                       <input
                         name="answer"
                         data-answer-input
                         maxlength="180"
                         autocomplete="off"
                         placeholder="写下你的想法"
                         value="${escapeHtml(inputValue)}"
                       />
                       ${renderVoiceStatus(page, checkpoint)}
                     </div>
                     <div class="answer-actions">
                       ${renderVoiceControls(page, checkpoint, { disabled: isAnalyzing })}
                       <button
                         class="agent-submit"
                         type="submit"
                         ${voiceBusyBlocksSubmit() ? "disabled" : ""}
                       >
                         ${canRetry ? "再想一想" : "提交"}
                       </button>
                     </div>
                   </form>`
          }
          ${
            canRetry
              ? `<p class="agent-attempt">${checkpointState.attempts}/${checkpoint.maxAttempts} 次思考</p>`
              : ""
          }
          ${
            checkpointState.error ? `<p class="agent-error">${escapeHtml(checkpointState.error)}</p>` : ""
          }
        </article>
      </aside>
    `;
  }

  function renderClueOverlay() {
    if (!state.activeClue) return "";
    const clue = state.activeClue;
    return `
      <div class="clue-overlay guide-overlay is-positive" aria-live="polite">
        <article class="agent-card clue-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(clue.label)}">
          ${renderGuideFigure("positive")}
          <div class="clue-kicker">${escapeHtml(clue.label)}</div>
          <h2>${escapeHtml(clue.title)}</h2>
          <p>${escapeHtml(clue.text)}</p>
          <span class="agent-hint">点击任意处继续</span>
        </article>
      </div>
    `;
  }

  function renderFinishedOverlay() {
    if (!state.finished) return "";
    const clueRecap = (story.clues || []).filter((clue) => state.clues.includes(clue.id));
    return `
      <aside class="finish-overlay" aria-live="polite" data-no-stage-advance>
        <div class="agent-kicker">故事完成</div>
        <h2>原来最难的，不一定是看见真相。有时候，是第一个把它说出来。</h2>
        <div class="clue-recap">
          ${
            clueRecap.length
              ? clueRecap
                  .map(
                    (clue) =>
                      `<span><strong>${escapeHtml(clue.title)}</strong>${escapeHtml(clue.text)}</span>`
                  )
                  .join("")
              : "<span>这一路的观察已经记在故事里。</span>"
          }
        </div>
      </aside>
    `;
  }

  function renderResetModal() {
    if (!resetModalOpen) return "";
    return `
      <div class="reset-backdrop" data-no-stage-advance>
        <section class="reset-dialog" role="dialog" aria-modal="true" aria-label="重新开始故事">
          <h2>重新开始故事？</h2>
          <div class="reset-actions">
            <button class="plain-button" type="button" data-action="cancel-reset">取消</button>
            <button class="danger-button" type="button" data-action="confirm-reset">重新开始</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderAffordance(canAdvance) {
    if (!canAdvance) return "";
    return `<div class="continue-affordance" aria-hidden="true">点击继续 ›</div>`;
  }

  function shouldShowStageAffordance(canAdvance, checkpointState) {
    if (!canAdvance) return false;
    if (state.activeClue) return false;
    if (checkpointState && checkpointState.status === "FEEDBACK") return false;
    return true;
  }

  function render() {
    const page = currentPage();
    const ps = pageState(page.id);
    const checkpoint = checkpointFor(page);
    const checkpointState = checkpoint && ps.checkpoint;
    const sceneAsset = sceneAssetFor(page, ps);
    const canGoBack = state.currentSceneIndex > 0 && !isTransitionLocked();
    const canAdvance = canStageAdvance(page, checkpointState);
    const stageClasses = [
      "story-stage",
      transitionDirection ? `is-${transitionDirection}` : "",
      canAdvance ? "can-advance" : "",
      isTransitionLocked() ? "is-transitioning" : "",
    ]
      .filter(Boolean)
      .join(" ");

    app.innerHTML = `
      <main class="storybook-shell">
        <section
          class="${stageClasses}"
          style="--stage-ratio:${STAGE_RATIO};"
          aria-label="${escapeHtml(pageLabel(page))}"
        >
          <img
            class="page-canvas"
            src="${escapeHtml(sceneAsset)}"
            alt="${escapeHtml(pageLabel(page))}"
            decoding="async"
          />

          <div class="stage-chrome" aria-label="故事控制">
            <div class="control-cluster control-left">
              ${controlButton("back", "back", "上一页", { disabled: !canGoBack })}
              ${controlButton("reset", "reset", "重新开始")}
              ${controlButton("sound", state.sound ? "sound" : "mute", state.sound ? "关闭声音" : "打开声音", {
                pressed: state.sound,
              })}
            </div>
            <div class="stage-progress" aria-label="故事进度 ${escapeHtml(progressLabel())}">
              <span>${escapeHtml(progressLabel())}</span>
              <div class="progress-dots">${progressDots()}</div>
            </div>
          </div>

          ${renderStoryTextPanel(page, currentUnit())}
          ${renderAfterNarrationOverlay(page, ps)}
          ${renderAgentOverlay(page, checkpoint, checkpointState)}
          ${renderClueOverlay()}
          ${renderFinishedOverlay()}
          ${renderResetModal()}
          ${renderAffordance(shouldShowStageAffordance(canAdvance, checkpointState))}
        </section>
      </main>
    `;

    const stage = app.querySelector(".story-stage");
    stage.addEventListener("click", (event) => {
      if (event.target.closest("[data-no-stage-advance]")) return;
      const bounds = stage.getBoundingClientRect();
      const clickX = event.clientX - bounds.left;
      const leftThird = bounds.width / 3;
      startBgm();
      if (clickX < leftThird) {
        goToPreviousUnit();
        return;
      }
      continueStory();
    });

    app.querySelector('[data-action="back"]').addEventListener("click", goBack);
    app.querySelector('[data-action="reset"]').addEventListener("click", requestReset);
    app.querySelector('[data-action="sound"]').addEventListener("click", toggleSound);

    const cancelResetButton = app.querySelector('[data-action="cancel-reset"]');
    if (cancelResetButton) cancelResetButton.addEventListener("click", cancelReset);
    const confirmResetButton = app.querySelector('[data-action="confirm-reset"]');
    if (confirmResetButton) confirmResetButton.addEventListener("click", confirmReset);

    const form = app.querySelector("[data-checkpoint-form]");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const activePage = currentPage();
        const activeCheckpoint = checkpointFor(activePage);
        if (!activeCheckpoint) return;
        const activeState = checkpointStateFor(pageState(activePage.id), activeCheckpoint);
        if (voiceBusyBlocksSubmit()) {
          activeState.error = "先等录音结束，再提交。";
          saveState();
          render();
          return;
        }
        const answer = form.elements.answer.value.trim();
        if (!answer) {
          activeState.error = "先写下一点想法，再提交。";
          saveState();
          render();
          return;
        }
        submitCheckpointAnswer(activePage, activeCheckpoint, answer);
      });
    }

    const voiceButton = app.querySelector("[data-voice-action]");
    if (voiceButton) {
      voiceButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const activePage = currentPage();
        const activeCheckpoint = checkpointFor(activePage);
        if (!activeCheckpoint) return;
        if (voiceButton.dataset.voiceAction === "stop") {
          stopVoiceRecording();
        } else {
          startVoiceRecording(activePage, activeCheckpoint);
        }
      });
    }

    preloadSceneAsset(state.currentSceneIndex + 1);
    preloadSceneAsset(state.currentSceneIndex - 1);
    preloadGuideAssets();
    preloadAudioAssets();
  }

  function currentGuideSpeechText() {
    if (state.activeClue) {
      return `${state.activeClue.title}。${state.activeClue.text}`;
    }
    if (state.finished) {
      return "原来最难的，不一定是看见真相。有时候，是第一个把它说出来。";
    }

    const page = currentPage();
    const checkpoint = checkpointFor(page);
    const checkpointState = checkpoint && pageState(page.id).checkpoint;

    if (checkpoint && checkpointState) {
      if (checkpointState.status === "QUESTION") return checkpoint.question;
      if (checkpointState.status === "FEEDBACK" && checkpointState.result) {
        return checkpointState.result.feedback;
      }
    }

    return page.narrationText || page.title;
  }

  function currentPageAllowsNarration(options = {}) {
    if (state.activeClue || state.finished || resetModalOpen) return false;
    if (!options.ignoreTransition && isTransitionLocked()) return false;
    const page = currentPage();
    const checkpoint = checkpointFor(page);
    const ps = pageState(page.id);
    const checkpointState = checkpoint && pageState(page.id).checkpoint;
    return Boolean(page.narrationText && !checkpointState && !ps.afterNarrationActive);
  }

  function clearScheduledSpeech() {
    if (scheduledSpeechTimer) {
      window.clearTimeout(scheduledSpeechTimer);
      scheduledSpeechTimer = 0;
    }
  }

  function clearScheduledCheckpoint() {
    if (scheduledCheckpointTimer) {
      window.clearTimeout(scheduledCheckpointTimer);
      scheduledCheckpointTimer = 0;
    }
  }

  function getBgmAudio() {
    if (bgmAudio) return bgmAudio;
    bgmAudio = new Audio(audioAssets.bgm);
    bgmAudio.preload = "auto";
    bgmAudio.volume = BGM_VOLUME;
    bgmAudio.addEventListener("ended", () => {
      window.clearTimeout(bgmLoopTimer);
      bgmLoopTimer = window.setTimeout(() => {
        if (!state.sound || !bgmAudio) return;
        bgmAudio.currentTime = 0;
        startBgm();
      }, BGM_LOOP_GAP_MS);
    });
    return bgmAudio;
  }

  function startBgm() {
    if (!state.sound) return;
    const audio = getBgmAudio();
    window.clearTimeout(bgmLoopTimer);
    audio.muted = false;
    audio.volume = bgmDucked ? BGM_DUCKED_VOLUME : BGM_VOLUME;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") playPromise.catch(() => {});
  }

  function stopBgm() {
    window.clearTimeout(bgmLoopTimer);
    bgmLoopTimer = 0;
    if (!bgmAudio) return;
    bgmAudio.pause();
  }

  function setBgmDucked(ducked) {
    bgmDucked = Boolean(ducked);
    if (!bgmAudio) return;
    bgmAudio.volume = bgmDucked ? BGM_DUCKED_VOLUME : BGM_VOLUME;
  }

  function setSpeechOutputActive(active) {
    speechOutputActive = Boolean(active);
    const page = currentPage();
    const checkpoint = checkpointFor(page);
    const status = app.querySelector("[data-voice-status]");
    if (status && (!currentVoiceScopedTo(page, checkpoint) || voiceState.status === "idle")) {
      status.textContent = voiceStatusFor(page, checkpoint).message;
      status.className = `voice-status is-${voiceStatusFor(page, checkpoint).status}`;
    }
    const button = app.querySelector('[data-voice-action="start"]');
    if (button) {
      button.disabled = !voiceInputSupported() || speechOutputActive;
    }
  }

  function stopSpeech() {
    clearScheduledSpeech();
    activeSpeechToken += 1;
    setSpeechOutputActive(false);
    if (currentSpeechAudio) {
      currentSpeechAudio.pause();
      currentSpeechAudio.src = "";
      currentSpeechAudio = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      currentSpeechUtterance = null;
    }
    setBgmDucked(false);
  }

  function stopAllAudio() {
    stopSpeech();
    stopBgm();
  }

  async function audioAssetAvailable(path) {
    if (!path) return false;
    if (audioAvailabilityCache.has(path)) return audioAvailabilityCache.get(path);
    try {
      const response = await fetch(path, { method: "HEAD", cache: "force-cache" });
      const contentType = response.headers.get("content-type") || "";
      const available = response.ok && contentType.includes("audio");
      audioAvailabilityCache.set(path, available);
      return available;
    } catch {
      audioAvailabilityCache.set(path, false);
      return false;
    }
  }

  function preloadStaticAudio(path) {
    if (!path || preloadedAssets.has(path)) return;
    preloadedAssets.add(path);
    audioAssetAvailable(path).then((available) => {
      if (!available) return;
      const audio = new Audio(path);
      audio.preload = "auto";
    });
  }

  function playAudioPath(path, token) {
    return new Promise((resolve) => {
      if (!state.sound || token !== activeSpeechToken) {
        resolve(false);
        return;
      }
      const audio = new Audio(path);
      currentSpeechAudio = audio;
      audio.volume = 1;
      audio.onended = () => resolve(true);
      audio.onerror = () => resolve(false);
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") playPromise.catch(() => resolve(false));
    });
  }

  function browserSpeechAvailable() {
    return Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
  }

  function browserSpeechVoices() {
    if (!browserSpeechAvailable()) return [];
    return window.speechSynthesis.getVoices() || [];
  }

  function selectBrowserVoice(role) {
    const voices = browserSpeechVoices();
    const chineseVoices = voices.filter((voice) => /zh|chinese|mandarin|普通话|中文/i.test(`${voice.lang} ${voice.name}`));
    const preferred = role === "guide"
      ? [/xiaoyou/i, /shelley.*chinese/i, /tingting/i, /xiaoxiao/i, /sandy.*chinese/i, /flo.*chinese/i]
      : [/xiaoxiao2/i, /xiaoxiao/i, /tingting/i, /meijia/i, /grandma.*chinese/i, /flo.*chinese/i];

    for (const pattern of preferred) {
      const match = chineseVoices.find((voice) => pattern.test(voice.name));
      if (match) return match;
    }
    return chineseVoices[0] || voices.find((voice) => /^zh/i.test(voice.lang)) || null;
  }

  function playBrowserSpeech(text, role, token) {
    return new Promise((resolve) => {
      if (!state.sound || token !== activeSpeechToken || !text || !browserSpeechAvailable()) {
        resolve(false);
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.voice = selectBrowserVoice(role);
      utterance.rate = role === "guide" ? 1.02 : 0.88;
      utterance.pitch = role === "guide" ? 1.06 : 0.96;
      utterance.volume = 1;
      utterance.onend = () => resolve(true);
      utterance.onerror = () => resolve(false);
      currentSpeechUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    });
  }

  async function playStaticSpeech(path, text, role) {
    if (!state.sound || (!path && !text)) return;
    stopSpeech();
    startBgm();

    const token = activeSpeechToken + 1;
    activeSpeechToken = token;
    setSpeechOutputActive(true);
    setBgmDucked(true);

    try {
      let played = false;
      if (path && (await audioAssetAvailable(path)) && state.sound && token === activeSpeechToken) {
        played = await playAudioPath(path, token);
      }
      if (!played && text && state.sound && token === activeSpeechToken) {
        played = await playBrowserSpeech(text, role, token);
      }
      currentSpeechAudio = null;
    } finally {
      if (token === activeSpeechToken) {
        setSpeechOutputActive(false);
        setBgmDucked(false);
      }
    }
  }

  function guideAudioPathForText(text) {
    if (!audioManifest.guidePathForText) return "";
    return audioManifest.guidePathForText(text);
  }

  function speakGuide(text) {
    playStaticSpeech(guideAudioPathForText(text), text, "guide");
  }

  function speakNarrationText(page, text, options = {}) {
    if (!page || !text) return;
    const useStaticAudio = options.useStaticAudio !== false && !page.narrationAudioNeedsRegeneration;
    const path = useStaticAudio && audioManifest.narrator ? audioManifest.narrator[page.id] : "";
    playStaticSpeech(path, text, "narrator");
  }

  function speakNarration(page) {
    if (!page || !page.narrationText || !currentPageAllowsNarration()) return;
    speakNarrationText(page, page.narrationText);
  }

  function queueNarrationForCurrentPage(delay = 0) {
    clearScheduledSpeech();
    if (!state.sound || !currentPageAllowsNarration({ ignoreTransition: true })) return;
    const page = currentPage();
    scheduledSpeechTimer = window.setTimeout(() => {
      scheduledSpeechTimer = 0;
      if (currentPage().id === page.id) speakNarration(page);
    }, delay);
  }

  window.addEventListener("pointerdown", startBgm, { passive: true });
  window.addEventListener("keydown", startBgm);
  window.addEventListener("pagehide", resetVoiceState);

  render();
  startBgm();
})();
