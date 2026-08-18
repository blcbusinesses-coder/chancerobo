import { ChanceAgent } from '../src/agents/chance/ChanceAgent.js';
import { zapierMCP } from '../src/core/functions/mcp.js';

/**
 * C.H.A.N.C.E — RASPBERRY PI BUILD (headless).
 * ---------------------------------------------------------------------------
 * No web UI, no Electron, no orb — this is the "projects & building" Chance
 * that lives on the Pi. You control him over TELEGRAM (and later voice +
 * robotics wired directly into the Pi's GPIO/peripherals).
 *
 * Run:  npm run pi     (from the project root on the Pi)
 *
 * It shares the SAME brain + tools as the desktop build (imports ../src), so
 * everything you've built carries over — it just has no screen.
 */
async function main() {
  const chance = new ChanceAgent();
  void zapierMCP.init();
  chance.activate(); // Telegram long-polling (owner-locked)

  console.log('══════════════════════════════════════════════');
  console.log('  C.H.A.N.C.E — Pi build ONLINE (headless)');
  console.log('  Channel: Telegram · No UI on this device');
  console.log('══════════════════════════════════════════════');

  // Keep the process alive.
  process.stdin.resume();
  const stop = async () => {
    console.log('\n[pi] shutting down…');
    try { await (chance as unknown as { shutdown?: () => Promise<void> }).shutdown?.(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error('[pi] fatal:', e);
  process.exit(1);
});
