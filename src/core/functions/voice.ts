import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { ElevenLabsClient } from 'elevenlabs';
import { env } from '../../config/env.js';

/**
 * Strips Markdown so the TTS engine doesn't read symbols aloud
 * (e.g. "**bold**" -> "bold" instead of "asterisk asterisk bold asterisk asterisk").
 */
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')                          // code fences
    .replace(/`([^`]+)`/g, '$1')                              // inline code
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')                 // images -> alt text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')                // links -> link text
    .replace(/https?:\/\/([^\s)]+)/g, (m) => {                // raw URLs -> just the host
      try { return new URL(m).hostname; } catch { return m.split('/')[0]; }
    })
    .replace(/(\*\*\*|___)(.*?)\1/g, '$2')                    // bold+italic
    .replace(/(\*\*|__)(.*?)\1/g, '$2')                       // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')                          // italic
    .replace(/^#{1,6}\s+/gm, '')                              // headers
    .replace(/^>\s?/gm, '')                                   // blockquotes
    .replace(/^[ \t]*[-*+]\s+/gm, '')                         // bullet markers
    .replace(/^-{3,}$/gm, '')                                 // horizontal rules
    .replace(/\|/g, ' ')                                      // table pipes
    .replace(/[*_~`#]/g, '')                                  // any leftover markdown symbols
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Free Edge-TTS voice presets Chance can switch between at runtime. */
export const VOICE_PRESETS: Record<number, { id: string; label: string }> = {
  1: { id: 'en-GB-RyanNeural', label: 'Ryan — warm British (default)' },
  2: { id: 'en-US-GuyNeural', label: 'Guy — upbeat American' },
  3: { id: 'en-US-ChristopherNeural', label: 'Christopher — deep American' },
};

let currentVoice = env.tts.voice || VOICE_PRESETS[1].id;

/** Switch the active Edge-TTS voice at runtime. Accepts a preset number or a raw voice id. */
export function setVoice(idOrPreset: string | number): string {
  const preset = VOICE_PRESETS[Number(idOrPreset)];
  currentVoice = preset ? preset.id : String(idOrPreset);
  return currentVoice;
}
export function getVoice(): string {
  return currentVoice;
}

/**
 * MANDATORY FUNCTION #3 — VOICE ENGINE
 * ------------------------------------
 * Incoming: Whisper / Speech-to-Text  -> text
 * Outgoing: Microsoft Edge Neural TTS (FREE, no key)  -> speech (mp3)
 *           ElevenLabs is an optional upgrade (TTS_PROVIDER=elevenlabs).
 *
 * Transcription uses OpenAI Whisper (OPENAI_API_KEY).
 */
export class VoiceEngine {
  private eleven: ElevenLabsClient | null = null;
  private voiceId: string;
  private outDir: string;

  constructor(voiceId: string, outDir = 'audio_cache') {
    this.voiceId = voiceId;
    this.outDir = outDir;
  }

  private eleventClient(): ElevenLabsClient {
    if (!this.eleven) {
      this.eleven = new ElevenLabsClient({ apiKey: env.elevenlabs.apiKey });
    }
    return this.eleven;
  }

  /**
   * INCOMING — transcribe an audio file to text via Whisper.
   * Uses the OpenAI audio/transcriptions endpoint over fetch to avoid an
   * extra SDK dependency.
   */
  async transcribe(audioPath: string): Promise<string> {
    if (!env.openai.apiKey) {
      throw new Error(
        '[voice] OPENAI_API_KEY not set. Provide it, or point transcribe() at a self-hosted Whisper endpoint.',
      );
    }
    const bytes = await fs.readFile(audioPath);
    const form = new FormData();
    form.append('model', 'whisper-1');
    form.append(
      'file',
      new Blob([bytes as unknown as ArrayBuffer]),
      path.basename(audioPath),
    );

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.openai.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`[voice] Whisper transcription failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { text: string };
    return json.text;
  }

  /**
   * OUTGOING — synthesize speech from text. Returns the path to the written mp3.
   * Free Edge TTS by default; ElevenLabs if TTS_PROVIDER=elevenlabs.
   */
  async speak(rawText: string, filename?: string): Promise<string> {
    const text = sanitizeForSpeech(rawText);
    await fs.mkdir(this.outDir, { recursive: true });
    const outPath = path.join(this.outDir, filename ?? `speech_${Date.now()}.mp3`);

    if (env.tts.provider === 'elevenlabs' && env.elevenlabs.apiKey && !env.elevenlabs.apiKey.includes('xxxx')) {
      const client = this.eleventClient();
      const audio = await client.textToSpeech.convert(this.voiceId, {
        text,
        model_id: 'eleven_multilingual_v2',
        output_format: 'mp3_44100_128',
      });
      const chunks: Buffer[] = [];
      for await (const chunk of audio as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
      await fs.writeFile(outPath, Buffer.concat(chunks));
      return outPath;
    }

    // Free path: Microsoft Edge neural TTS (no API key).
    const tts = new MsEdgeTTS();
    await tts.setMetadata(currentVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
      audioStream.on('end', () => resolve());
      audioStream.on('error', reject);
    });
    await fs.writeFile(outPath, Buffer.concat(chunks));
    return outPath;
  }

  /** Helper for callers that already hold a file stream. */
  fileStream(p: string) {
    return createReadStream(p);
  }
}
