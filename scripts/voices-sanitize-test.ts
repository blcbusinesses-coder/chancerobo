import { sanitizeForSpeech } from '../src/core/functions/voice.js';

const sample =
  'Done. **"A FIGHT ALMOST BROKE OUT AFTER THIS AAU TEAM WAS COOKING US!"** by Cam Wilder is open and playing on your screen. Enjoy the chaos. 🎬 See it at https://www.youtube.com/watch?v=abc123';

console.log('BEFORE:', sample);
console.log('AFTER: ', sanitizeForSpeech(sample));
