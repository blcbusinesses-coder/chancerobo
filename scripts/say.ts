import { env } from '../src/config/env.js';
import { VoiceEngine } from '../src/core/functions/voice.js';

/**
 * Speak text in Chance's configured voice (ElevenLabs).
 *   npm run say -- "your text here"
 */
const text =
  process.argv.slice(2).join(' ').trim() ||
  "Systems online, Beckitt. George here. Keys are hot, five functions armed — let's make you unstoppable.";

const voice = new VoiceEngine(env.elevenlabs.voiceIdChance);
console.log(`[say] voice ${env.elevenlabs.voiceIdChance} · "${text}"`);
const out = await voice.speak(text, 'chance_test.mp3');
console.log(`[say] wrote ${out}`);
