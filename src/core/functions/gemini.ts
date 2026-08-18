import { env } from '../../config/env.js';

/**
 * GOOGLE GEMINI (via the Generative Language API / AI Studio key).
 * Text/reasoning with huge context + multimodal, plus Imagen image generation.
 */
const GBASE = 'https://generativelanguage.googleapis.com/v1beta';

export class Gemini {
  get configured(): boolean {
    return Boolean(env.gemini.apiKey);
  }
  private key(): string {
    if (!env.gemini.apiKey) throw new Error('GEMINI_API_KEY not set — add it to .env (get one at aistudio.google.com/apikey).');
    return env.gemini.apiKey;
  }

  /** Ask Gemini a question (text). */
  async ask(prompt: string, model = env.gemini.model): Promise<string> {
    const res = await fetch(`${GBASE}/models/${model}:generateContent?key=${this.key()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const d: any = await res.json();
    return (d?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text).filter(Boolean).join('\n');
  }

  /** Generate image(s) with a Gemini image model (returns inline base64). Returns data: URIs. */
  async generateImages(prompt: string, n = 1): Promise<string[]> {
    const model = env.gemini.imageModel;
    const out: string[] = [];
    for (let i = 0; i < Math.min(Math.max(n, 1), 4); i++) {
      const res = await fetch(`${GBASE}/models/${model}:generateContent?key=${this.key()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } }),
      });
      if (!res.ok) throw new Error(`Gemini image ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const d: any = await res.json();
      for (const p of d?.candidates?.[0]?.content?.parts ?? []) {
        if (p.inlineData?.data) out.push(`data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`);
      }
    }
    return out;
  }
}
