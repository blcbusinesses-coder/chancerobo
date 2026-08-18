import { ModelRouter } from '../src/core/ModelRouter.js';
import { createChanceFrontendConfig } from '../src/agents/chance/config.js';
import { TaskComplexity } from '../src/core/types.js';

/**
 * Offline demo — no API keys required.
 * Proves the tri-tier router classifies tasks and maps them to the right
 * Claude model, and prints CHANCE's frontend identity config.
 *
 *   npm run demo
 */
const router = new ModelRouter();

const SAMPLE_TASKS = [
  'Architect the multi-agent message bus and write the TypeScript for it.',
  'Draft a plan to migrate our billing schema with zero downtime.',
  'What did the customer say they wanted in that last email?',
  'Reply to Dana and confirm the Tuesday meeting.',
  'Scrape the pricing table from this URL and extract the tiers.',
  'Classify this ticket: is it a refund request? yes or no.',
];

const tierIcon: Record<TaskComplexity, string> = {
  [TaskComplexity.BIG]: '🧠 BIG   ',
  [TaskComplexity.MEDIUM]: '💬 MEDIUM',
  [TaskComplexity.SMALL]: '⚡ SMALL ',
};

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  TRI-TIER MODEL ROUTING  —  live classification (no API call)');
console.log('══════════════════════════════════════════════════════════════\n');

for (const task of SAMPLE_TASKS) {
  const complexity = router.classify(task);
  const model = router.resolveModel(complexity);
  console.log(`${tierIcon[complexity]} → ${model}`);
  console.log(`   "${task}"\n`);
}

console.log('──────────────────────────────────────────────────────────────');
console.log(`  Anthropic key detected: ${router.isLive ? 'YES (live calls enabled)' : 'no (routing still works offline)'}`);
console.log('──────────────────────────────────────────────────────────────\n');

console.log('  CHANCE — frontend identity config (Mandatory Function #5):\n');
console.log(JSON.stringify(createChanceFrontendConfig(), null, 2));
console.log('');
