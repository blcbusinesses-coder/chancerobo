import { env } from '../../config/env.js';

/**
 * VISION — thin client for the local Python vision service (vision/service.py).
 *
 * All the actual work (webcam capture, MediaPipe object detection, hand→cursor
 * control) happens locally in Python with NO API credits. This class just makes
 * HTTP calls to that service so Chance can trigger it as a tool.
 */
export interface SeeResult {
  ok: boolean;
  width: number;
  height: number;
  objects: { label: string; score: number; box: number[] }[];
  summary: { label: string; count: number }[];
  imageData?: string; // data: URI of the annotated frame
}

export class Vision {
  private base = env.vision.serviceUrl.replace(/\/$/, '');

  private async call(path: string, method = 'POST'): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, { method });
    } catch {
      throw new Error(
        'Vision service is not running. Start it with:  npm run vision   (opens the webcam service on port 8788).',
      );
    }
    const text = await res.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(json?.error || `Vision service ${res.status}`);
    return json;
  }

  /** Is the service up? Returns null if unreachable (rather than throwing). */
  async health(): Promise<{ ok: boolean; camera_open: boolean; cam_index: number; hands_running: boolean } | null> {
    try {
      return await this.call('/health', 'GET');
    } catch {
      return null;
    }
  }

  /** Grab a frame and detect objects (annotated image included). */
  async see(): Promise<SeeResult> {
    return this.call('/see', 'POST');
  }

  async handsStart(): Promise<{ ok: boolean; running: boolean }> {
    return this.call('/hands/start', 'POST');
  }

  async handsStop(): Promise<{ ok: boolean; running: boolean }> {
    return this.call('/hands/stop', 'POST');
  }

  async handsStatus(): Promise<{ running: boolean }> {
    return this.call('/hands/status', 'GET');
  }

  /** Start/stop projector gesture control (streams a hand cursor to the projector). */
  async gestureStart(target = 'http://127.0.0.1:8787/api/projector/gesture'): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/gesture/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }) });
    } catch {
      throw new Error('Vision service is not running. Start it with:  npm run vision');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as any)?.error || `Vision service ${res.status}`);
    return json;
  }
  async gestureStop(): Promise<any> {
    return this.call('/gesture/stop', 'POST');
  }

  async handsConfig(): Promise<any> {
    return this.call('/hands/config', 'GET');
  }

  /** The numbered, targetable screens (array panels + any projector/external). */
  async screens(): Promise<{ screens: { n: number; label: string; projector?: boolean }[] }> {
    return this.call('/screens', 'GET');
  }

  /** Update motion-control mapping: { monitor, sensitivity, smooth, pinch, ... }. */
  async setHandsConfig(patch: Record<string, unknown>): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/hands/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch {
      throw new Error('Vision service is not running. Start it with:  npm run vision');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as any)?.error || `Vision service ${res.status}`);
    return json;
  }
}
