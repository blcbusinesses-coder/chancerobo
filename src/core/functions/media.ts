import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '../../config/env.js';

const execAsync = promisify(exec);

/**
 * MEDIA — play YouTube / video on the screen via mpv + yt-dlp. No browser.
 *
 * yt-dlp extracts the stream from a YouTube URL or search; mpv plays it with
 * hardware acceleration. Lightweight and identical on Windows and the Pi, so
 * this ports straight to the portable/robotics unit.
 */
const MPV = env.media.mpvPath;
const YTDLP = env.media.ytdlpPath;

export class Media {
  private isUrl(s: string): boolean {
    return /^https?:\/\//i.test(s.trim());
  }

  /** Turn a URL or search phrase into a concrete video URL + title. */
  async resolve(query: string): Promise<{ url: string; title: string }> {
    const q = query.trim();
    if (this.isUrl(q)) {
      let title = q;
      try {
        const { stdout } = await execAsync(`"${YTDLP}" --no-warnings --get-title "${q}"`, { timeout: 20_000 });
        title = stdout.trim() || q;
      } catch { /* keep url as title */ }
      return { url: q, title };
    }
    const safe = q.replace(/"/g, '');
    const { stdout } = await execAsync(
      `"${YTDLP}" --no-warnings --get-title --get-id "ytsearch1:${safe}"`,
      { timeout: 30_000 },
    );
    const lines = stdout.trim().split('\n').filter(Boolean);
    const title = lines[0] || q;
    const id = lines[lines.length - 1] || '';
    if (!id) throw new Error(`No YouTube result for "${query}".`);
    return { url: `https://www.youtube.com/watch?v=${id}`, title };
  }

  /** Play a video/YouTube result on screen. Fullscreen by default. */
  async play(query: string, opts: { fullscreen?: boolean; audioOnly?: boolean } = {}): Promise<{ playing: true; title: string; url: string }> {
    const { url, title } = await this.resolve(query);
    const args = [
      // mpv was launched by a process without yt-dlp on PATH, so point it explicitly.
      `--script-opts=ytdl_hook-ytdl_path=${YTDLP}`,
      '--force-window=immediate',
      '--hwdec=auto',
      opts.fullscreen === false ? '--no-fullscreen' : '--fullscreen',
      ...(opts.audioOnly ? ['--no-video'] : []),
      url,
    ];
    const child = spawn(MPV, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { playing: true, title, url };
  }

  /** Stop whatever is playing (closes the mpv window). */
  async stop(): Promise<{ stopped: true }> {
    await execAsync('taskkill /IM mpv.exe /F').catch(() => {});
    return { stopped: true };
  }

  /**
   * Resolve a query or URL to a YouTube video id + embed URL — keyless (scrapes
   * the search page), so it works on the Pi with no yt-dlp needed. Used to EMBED
   * a video in the browser (projector / popup), vs play() which uses mpv.
   */
  async youtubeEmbed(query: string): Promise<{ id: string; embedUrl: string } | null> {
    const q = query.trim();
    const direct = q.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    if (direct) return { id: direct[1], embedUrl: `https://www.youtube.com/embed/${direct[1]}` };
    try {
      const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const html = await res.text();
      const m = html.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
      if (m) return { id: m[1], embedUrl: `https://www.youtube.com/embed/${m[1]}` };
    } catch { /* ignore */ }
    return null;
  }
}
