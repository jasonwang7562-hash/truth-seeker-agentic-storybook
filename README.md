# Truth Seeker: An Agentic Storybook

Interactive children's picture-book MVP for the EAZO Hackathon, based on **The Emperor's New Clothes**. The app uses the supplied scene artwork in a linear storybook flow, with a small number of authored thinking checkpoints.


Live Demo: https://emperor-new-cloth.netlify.app

An AI-powered interactive storybook based on *The Emperor's New Clothes*, where children explore the story through voice interaction, clue cards, AI narration, BGM, and agent-guided decision points.
## Why Agents Are Used

The main story progression is deterministic and owned by the browser runtime. One child-friendly Guide Agent appears only at the six authored scene checkpoints:

- emperor's wardrobe: motivation and character observation;
- suspicious wording: social pressure hidden in “only smart people can see it”;
- empty loom: direct observation versus what characters claim;
- mirror comparison: comparing appearance with evidence;
- parade: conformity and fear of speaking up;
- final reflection: the child's own response to knowing the truth.

The Guide classifies free-text answers into a small, validated schema, then generates a fresh reply from the child's wording, the already-revealed scene context, and the checkpoint's authored guidance intention. It never controls story order. The app always works without an API key: authored fallback classification and feedback keep the story moving.

## Architecture

- `public/story-data.js` contains the fixed page order, Guide checkpoint definitions, clue definitions, rubrics, retry guidance, and authored fallbacks.
- `public/app.js` owns the deterministic linear story state machine, interaction gates, after-interaction narration, checkpoint attempts, clue state, local progress, and all page navigation.
- `public/styles.css` provides the picture-book UI layer, responsive framing, clue animation, and touch-friendly controls.
- `public/assets/scenes/` contains cropped scene artwork derived from the supplied screenshots.
- `server.js` serves the static app locally and exposes `/api/agent` and `/api/transcribe`.
- `lib/agent-runtime.js` is the constrained Guide classifier runtime with validation and fallback handling.
- `lib/transcribe-runtime.js` is the server-side speech-to-text helper for temporary microphone uploads when browser speech recognition is unavailable.
- `public/audio-manifest.js` maps fixed narration and Guide lines to pre-generated local audio assets.
- `scripts/audio-inventory.mjs` prints the deterministic IndexTTS2/CosyVoice 2 generation inventory.
- `api/agent.js`, `api/transcribe.js`, and matching Netlify functions provide the same API endpoints for serverless deployment.

## Setup

Requirements: Node.js 18+ and npm.

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

## Environment Variables

No environment variables are required for the fallback-only deploy.

Copy `.env.example` to `.env` only if you want live Guide classifications or server-side voice transcription:

```bash
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-4.1-mini
OPENAI_STT_MODEL=whisper-1
OPENAI_STT_LANGUAGE=zh
OPENAI_BASE_URL=https://api.openai.com/v1
```

`OPENAI_STT_MODEL` defaults to `whisper-1` and `OPENAI_STT_LANGUAGE` defaults to `zh`. Never expose API keys client-side. The browser calls only `/api/agent` and `/api/transcribe`, which Netlify rewrites to serverless functions.

## Audio Assets

Runtime TTS is intentionally disabled for the demo. The browser plays only local audio files when they exist:

- fixed Narrator scenes: `public/assets/audio/narration/scene-01.wav` through `scene-06.wav`, generated offline with IndexTTS2;
- deterministic Guide lines: hashed WAV files under `public/assets/audio/guide/`, generated offline with CosyVoice 2;
- global BGM: `public/assets/audio/bgm-global.mp3`.

Scenes 1-5 now have revised before/after narration timing and are marked with `narrationAudioNeedsRegeneration`; the runtime skips their stale fixed WAVs and uses browser speech fallback until matching narrator audio is regenerated. Scene 6 still matches the existing fixed narration asset.

Generate the line inventory with:

```bash
npm run audio:inventory
```

Only use legally usable reference recordings. Do not commit team/private reference recordings unless the team explicitly permits redistribution.

License notes for the intended offline generators:

- IndexTTS2: upstream `index-tts/index-tts` uses the bilibili Model Use License; confirm public hackathon/demo redistribution rights before publishing generated audio.
- CosyVoice 2: upstream `FunAudioLLM/CosyVoice` is Apache-2.0; reference recordings still need separate permission.

## Build

```bash
npm run build
```

The static build is written to `dist/`.

Preview the built app:

```bash
npm run preview
```

## Deployment

Netlify is the intended deployment target.

Build command:

```bash
npm run build
```

Publish directory:

```text
dist
```

Functions directory:

```text
netlify/functions
```

Netlify config is in `netlify.toml` and already includes:

- the build command;
- the publish directory;
- the API rewrites from `/api/agent` and `/api/transcribe` to Netlify Functions;
- the SPA fallback to `/index.html`.

GitHub → Netlify steps:

1. Push this repository to GitHub.
2. In Netlify, choose **Add new site** → **Import an existing project**.
3. Connect the GitHub repository.
4. Keep the default branch you want to deploy from.
5. Leave build command as `npm run build`.
6. Leave publish directory as `dist`.
7. If you want live Agent replies or voice transcription, add `OPENAI_API_KEY` and optionally `OPENAI_MODEL`, `OPENAI_STT_MODEL`, `OPENAI_STT_LANGUAGE`, and `OPENAI_BASE_URL` in Netlify site settings.
8. Click **Deploy site**.

## Dynamic vs Deterministic Behavior

Deterministic:

- scene progression;
- Guide checkpoints and clue overlays;
- before/after narration timing around Guide responses;
- final truth and reflection.

Dynamic when configured:

- semantic classification of a child's free-text checkpoint answer;
- one short Guide feedback message.
- microphone answers transcribed by browser speech recognition when available, or server-side STT otherwise, then submitted through the same checkpoint answer pipeline as typed text.

Fallback:

- missing API keys, endpoint failures, network errors, malformed provider output, unsupported categories, and timeouts all use authored fallback results;
- voice transcription failures show a short retry/type fallback message and never count as a story-answer attempt;
- the client limits factual checkpoints to two attempts and always allows the story to continue;
- the final reflection is never treated as correct or incorrect.

## Future Stories

Future stories can reuse the runtime by adding fixed pages, checkpoint definitions, and clue definitions in `public/story-data.js`. No multi-agent architecture is required.

## Known Limitations

- Voice files are expected to be generated offline and are not created by the web app.
- Microphone input requires a secure browser context, microphone permission, and either browser speech recognition or MediaRecorder support; unsupported browsers keep typed answers available.
- Missing local narration/Guide audio does not block story progression; it simply stays silent apart from BGM.
- The supplied flattened screenshots are used as scene art, so deeper character animation is limited.
- The fallback classifier is intentionally lightweight; configured providers give more nuanced answer classification.
