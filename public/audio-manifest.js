(function () {
  const narrator = {
    wardrobe: "/assets/audio/narration/scene-01.wav",
    scammers: "/assets/audio/narration/scene-02.wav",
    weaving: "/assets/audio/narration/scene-03.wav",
    mirror: "/assets/audio/narration/scene-04.wav",
    parade: "/assets/audio/narration/scene-05.wav",
    truth: "/assets/audio/narration/scene-06.wav",
  };

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function hashText(value) {
    const text = normalizeText(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function guidePathForText(text) {
    const normalized = normalizeText(text);
    if (!normalized) return "";
    return `/assets/audio/guide/${hashText(normalized)}.wav`;
  }

  globalThis.EAZO_AUDIO_MANIFEST = {
    workflow: {
      narratorProvider: "IndexTTS2",
      guideAudio: false,
      runtimeTts: false,
      browserSpeechFallback: false,
    },
    narrator,
    normalizeText,
    hashText,
    guidePathForText,
  };
})();
