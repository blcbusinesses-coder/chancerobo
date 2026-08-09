import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { ElevenLabsClient } from 'elevenlabs';
import { env } from '../../config/env.js';

/**
 * MANDATORY FUNCTION #3 — VOICE ENGINE
 * ------------------------------------
 * Incoming: Whisper / Speech-to-Text  -> text
 * Outgoing: ElevenLabs                -> speech (mp3)
 *
 * Transcription uses OpenAI Whisper if OPENAI_API_KEY is set. If you run a
 * self-hosted Whisper, point `transcribe()` at that endpoint instead.
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
   * OUTGOING — synthesize speech from text via ElevenLabs.
   * Returns the path to the written mp3.
   */
  async speak(text: string, filename?: string): Promise<string> {
    const client = this.eleventClient();
    const audio = await client.textToSpeech.convert(this.voiceId, {
      text,
      model_id: 'eleven_multilingual_v2',
      output_format: 'mp3_44100_128',
    });

    await fs.mkdir(this.outDir, { recursive: true });
    const outPath = path.join(this.outDir, filename ?? `speech_${Date.now()}.mp3`);

    // The SDK returns a Readable stream of audio bytes.
    const chunks: Buffer[] = [];
    for await (const chunk of audio as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    await fs.writeFile(outPath, Buffer.concat(chunks));
    return outPath;
  }

  /** Helper for callers that already hold a file stream. */
  fileStream(p: string) {
    return createReadStream(p);
  }
}
