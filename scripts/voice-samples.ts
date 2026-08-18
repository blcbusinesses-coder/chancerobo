import { VoiceEngine, VOICE_PRESETS, setVoice } from '../src/core/functions/voice.js';

/** Generates one comparison clip per free Edge-TTS voice preset. npm run voice:samples */
const line =
  "Systems online, Beckitt. This is a voice test — same line, different voice, so you can compare side by side.";

const engine = new VoiceEngine('unused-for-edge-path');

for (const [num, preset] of Object.entries(VOICE_PRESETS)) {
  setVoice(Number(num));
  const file = await engine.speak(line, `voice_${num}.mp3`);
  console.log(`[voice:samples] ${num} = ${preset.label} -> ${file}`);
}
