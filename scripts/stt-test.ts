import { VoiceEngine } from '../src/core/functions/voice.js';

/** Verifies speech-to-text on an existing audio file. npm run stt:test [path] */
const file = process.argv[2] || 'audio_cache/chance_test.mp3';
const v = new VoiceEngine('JBFqnCBsd6RMkjVDRZzb');
console.log(`[stt:test] transcribing ${file} ...`);
const text = await v.transcribe(file);
console.log(`[stt:test] ✅ result: "${text}"`);
