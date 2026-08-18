/** MiniMax-M3 pay-as-you-go pricing (standard tier, <=512k context). USD per 1M tokens. */
const MINIMAX_PRICE_PER_M = { input: 0.3, output: 1.2 };

export function minimaxCostCents(promptTokens: number, completionTokens: number): number {
  const usd = (promptTokens / 1_000_000) * MINIMAX_PRICE_PER_M.input + (completionTokens / 1_000_000) * MINIMAX_PRICE_PER_M.output;
  return usd * 100;
}
