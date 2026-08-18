import crypto from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * KLING AI — image + video generation.
 * Official API auth: sign a JWT (HS256) with Access Key (iss) + Secret Key.
 * Falls back to a plain Bearer token (KLING_API_KEY) for third-party wrappers.
 */
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeJwt(accessKey: string, secretKey: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 }));
  const sig = b64url(crypto.createHmac('sha256', secretKey).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

export class KlingAI {
  get configured(): boolean {
    return Boolean((env.kling.accessKey && env.kling.secretKey) || env.kling.apiKey);
  }

  private token(): string {
    if (env.kling.accessKey && env.kling.secretKey) return makeJwt(env.kling.accessKey, env.kling.secretKey);
    if (env.kling.apiKey) return env.kling.apiKey;
    throw new Error('Kling not configured — set KLING_ACCESS_KEY + KLING_SECRET_KEY (or KLING_API_KEY).');
  }

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${env.kling.base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${this.token()}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(`Kling ${res.status}: ${json?.message || text}`.slice(0, 300));
    return json;
  }

  /** Poll a task endpoint until it succeeds or times out. */
  private async poll(path: string, timeoutMs: number): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = await this.req('GET', path);
      const status = r?.data?.task_status;
      if (status === 'succeed') return r.data.task_result;
      if (status === 'failed') throw new Error(`Kling task failed: ${r?.data?.task_status_msg || 'unknown'}`);
      await new Promise((res) => setTimeout(res, 4000));
    }
    throw new Error('Kling task timed out.');
  }

  /** Text -> image(s). Returns image URLs. */
  async generateImage(prompt: string, opts: { aspectRatio?: string; n?: number } = {}): Promise<string[]> {
    const sub = await this.req('POST', '/v1/images/generations', {
      model_name: 'kling-v1',
      prompt,
      aspect_ratio: opts.aspectRatio || '16:9',
      n: opts.n || 1,
    });
    const id = sub?.data?.task_id;
    const result = await this.poll(`/v1/images/generations/${id}`, 120_000);
    return (result?.images ?? []).map((i: any) => i.url).filter(Boolean);
  }

  /** Text -> video. Returns a video URL. (Slow — can take minutes.) */
  async generateVideo(prompt: string, opts: { aspectRatio?: string; duration?: string } = {}): Promise<string> {
    const sub = await this.req('POST', '/v1/videos/text2video', {
      model_name: 'kling-v1',
      prompt,
      aspect_ratio: opts.aspectRatio || '16:9',
      duration: opts.duration || '5',
    });
    const id = sub?.data?.task_id;
    const result = await this.poll(`/v1/videos/text2video/${id}`, 360_000);
    return result?.videos?.[0]?.url;
  }

  /** Image -> video (animate an image). */
  async imageToVideo(imageUrl: string, prompt = ''): Promise<string> {
    const sub = await this.req('POST', '/v1/videos/image2video', { model_name: 'kling-v1', image: imageUrl, prompt });
    const id = sub?.data?.task_id;
    const result = await this.poll(`/v1/videos/image2video/${id}`, 360_000);
    return result?.videos?.[0]?.url;
  }
}
