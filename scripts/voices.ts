import { env } from '../src/config/env.js';

/**
 * Lists the ElevenLabs voices available to your account, with their Voice IDs.
 * Copy the voice_id you want into ELEVENLABS_VOICE_ID_CHANCE in .env.
 *
 *   npm run voices
 */
const key = env.elevenlabs.apiKey;

const res = await fetch('https://api.elevenlabs.io/v1/voices', {
  headers: { 'xi-api-key': key },
});

if (!res.ok) {
  console.error(`\n[voices] ElevenLabs API error ${res.status}: ${await res.text()}`);
  console.error('Check that ELEVENLABS_API_KEY in .env is correct.\n');
  process.exit(1);
}

const data = (await res.json()) as {
  voices: { name: string; voice_id: string; category: string; labels?: Record<string, string> }[];
};

console.log(`\n  Found ${data.voices.length} voice(s) on your account:\n`);
console.log('  ' + 'NAME'.padEnd(22) + 'VOICE ID'.padEnd(26) + 'TYPE');
console.log('  ' + '─'.repeat(60));
for (const v of data.voices) {
  console.log('  ' + v.name.padEnd(22) + v.voice_id.padEnd(26) + (v.category ?? ''));
}
console.log('\n  → Put the one you want in .env:  ELEVENLABS_VOICE_ID_CHANCE=<voice_id>\n');
