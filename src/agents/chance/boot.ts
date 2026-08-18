import { ChanceAgent } from './ChanceAgent.js';
import { startApiServer } from '../../api/server.js';

/**
 * Boot CHANCE: instantiate Agent Zero, activate its channels, and keep alive.
 * Run with: `npm run chance`
 */
async function main() {
  const chance = new ChanceAgent();

  console.log('════════════════════════════════════════════');
  console.log('  C.H.A.N.C.E ECOSYSTEM — booting Agent Zero');
  console.log('════════════════════════════════════════════');
  console.log(chance.identity.toJSON());

  chance.activate();

  startApiServer(chance, Number(process.env.PORT) || 8787);

  // A quick self-test through the tri-tier router (skips gracefully w/o API key).
  try {
    const res = await chance.run({
      channel: 'api',
      text: 'Chance, confirm you are online and give me a one-line status.',
    });
    console.log(`\n[${res.modelUsed} · ${res.complexity}] ${res.text}\n`);
  } catch (err) {
    console.warn('[boot] Self-test skipped (likely missing ANTHROPIC_API_KEY):', (err as Error).message);
  }

  const shutdown = async () => {
    console.log('\n[boot] Shutting down CHANCE...');
    await chance.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[boot] Fatal:', err);
  process.exit(1);
});
