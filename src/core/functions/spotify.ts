import { env } from '../../config/env.js';

/**
 * SPOTIFY — controls playback through the Spotify Web API (Spotify Connect).
 *
 * The API doesn't play audio itself; it remote-controls a Spotify app that's
 * already running and signed in (desktop app, phone, etc.). Playback control
 * (play / pause / skip / volume) requires a Spotify Premium account.
 *
 * Auth: a one-time OAuth consent (scripts/spotify-auth.ts) yields a long-lived
 * refresh token, which we exchange for short-lived access tokens as needed.
 */
const ACCOUNTS = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

export const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
  'playlist-read-private',
].join(' ');

export class Spotify {
  private accessToken = '';
  private expiresAt = 0;

  get configured(): boolean {
    return Boolean(env.spotify.clientId && env.spotify.clientSecret && env.spotify.refreshToken);
  }

  private basicAuth(): string {
    return Buffer.from(`${env.spotify.clientId}:${env.spotify.clientSecret}`).toString('base64');
  }

  /** Get a valid access token, refreshing via the stored refresh token when stale. */
  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 30_000) return this.accessToken;
    if (!env.spotify.refreshToken) {
      throw new Error('Spotify not authorized yet — run: node --import tsx scripts/spotify-auth.ts');
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.spotify.refreshToken,
    });
    const res = await fetch(ACCOUNTS, {
      method: 'POST',
      headers: { Authorization: `Basic ${this.basicAuth()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Spotify token refresh failed: ${res.status} ${await res.text()}`);
    const j: any = await res.json();
    this.accessToken = j.access_token;
    this.expiresAt = Date.now() + (j.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  /** Authenticated call to the Web API. Returns parsed JSON, or null for empty (204) bodies. */
  private async api(path: string, init: RequestInit = {}): Promise<any> {
    const token = await this.token();
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      // Bubble up the most useful Spotify error message.
      let msg = text;
      try { msg = JSON.parse(text)?.error?.message || text; } catch { /* keep raw */ }
      throw new Error(`Spotify ${res.status}: ${msg}`);
    }
    return text ? JSON.parse(text) : null;
  }

  /** List devices Spotify can play on (the desktop app / phone must be open). */
  async devices(): Promise<{ id: string; name: string; type: string; active: boolean; volume: number | null }[]> {
    const j = await this.api('/me/player/devices');
    return (j?.devices || []).map((d: any) => ({
      id: d.id, name: d.name, type: d.type, active: d.is_active, volume: d.volume_percent,
    }));
  }

  /**
   * Pick a device to target. Preference order: the currently-active device,
   * then a real Spotify app (desktop/phone) over idle browser Web Player tabs
   * — those register as devices but often don't actually output sound.
   */
  private async pickDevice(): Promise<{ id: string; name: string } | null> {
    const devs = await this.devices();
    if (!devs.length) return null;
    const isWebPlayer = (d: { name: string }) => /web player/i.test(d.name);
    const chosen =
      devs.find((d) => d.active) ||
      devs.find((d) => !isWebPlayer(d)) ||
      devs[0];
    return { id: chosen.id, name: chosen.name };
  }

  /**
   * Transfer playback to a device chosen by name (fuzzy: "phone", "desktop",
   * "living room"…). Optionally start playing immediately. Returns the device
   * it landed on so the caller can confirm.
   */
  async transfer(nameQuery: string, play = true): Promise<{ ok: true; device: string }> {
    const devs = await this.devices();
    if (!devs.length) {
      throw new Error('No Spotify devices found. Open the Spotify app on the target (phone/desktop), then try again.');
    }
    const q = nameQuery.trim().toLowerCase();
    // Map common words to Spotify device types when the name doesn't match directly.
    const typeHint =
      /phone|mobile|cell/.test(q) ? 'smartphone' :
      /desktop|computer|pc|laptop/.test(q) ? 'computer' :
      /tv|speaker|cast|living|kitchen|bedroom|echo|sonos/.test(q) ? 'speaker|tv|cast|avr' : '';
    const match =
      devs.find((d) => d.name.toLowerCase().includes(q)) ||
      (typeHint ? devs.find((d) => new RegExp(typeHint, 'i').test(d.type)) : undefined) ||
      devs.find((d) => !/web player/i.test(d.name));
    if (!match) {
      const names = devs.map((d) => `${d.name} (${d.type})`).join(', ');
      throw new Error(`No device matched "${nameQuery}". Available: ${names}.`);
    }
    await this.api('/me/player', {
      method: 'PUT',
      body: JSON.stringify({ device_ids: [match.id], play }),
    });
    return { ok: true, device: match.name };
  }

  /** Search tracks/artists/albums/playlists. */
  async search(query: string, type = 'track', limit = 5) {
    const j = await this.api(`/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}`);
    const key = `${type}s`;
    const items = j?.[key]?.items || [];
    return items.map((it: any) => ({
      name: it.name,
      uri: it.uri,
      id: it.id,
      artist: (it.artists || []).map((a: any) => a.name).join(', '),
      album: it.album?.name,
    }));
  }

  /**
   * Play. With no argument, resumes. With a search query or Spotify URI, plays
   * that. Ensures a device is targeted (transferring to it if idle).
   */
  async play(what?: string): Promise<{ ok: true; nowPlaying?: any; device?: string }> {
    const device = await this.pickDevice();
    if (!device) {
      throw new Error('No Spotify device found. Open the Spotify app (desktop or phone) and sign in, then try again.');
    }
    const q = `?device_id=${device.id}`;

    let body: any = undefined;
    if (what && what.trim()) {
      let uri = what.trim();
      if (!uri.startsWith('spotify:')) {
        const [top] = await this.search(uri, 'track', 1);
        if (!top) throw new Error(`No track found for "${what}".`);
        uri = top.uri;
      }
      body = uri.includes(':playlist:') || uri.includes(':album:') || uri.includes(':artist:')
        ? { context_uri: uri }
        : { uris: [uri] };
    }

    await this.api(`/me/player/play${q}`, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
    const now = await this.current().catch(() => undefined);
    return { ok: true, nowPlaying: now, device: device.name };
  }

  async pause() { await this.api('/me/player/pause', { method: 'PUT' }); return { ok: true }; }
  async next() { await this.api('/me/player/next', { method: 'POST' }); return { ok: true }; }
  async previous() { await this.api('/me/player/previous', { method: 'POST' }); return { ok: true }; }

  /** Set volume 0-100 (Premium; not supported on all device types). */
  async setVolume(percent: number) {
    const v = Math.max(0, Math.min(100, Math.round(percent)));
    await this.api(`/me/player/volume?volume_percent=${v}`, { method: 'PUT' });
    return { ok: true, volume: v };
  }

  /** Add a track to the play queue (by search query or URI). */
  async queue(what: string) {
    let uri = what.trim();
    let label = what;
    if (!uri.startsWith('spotify:')) {
      const [top] = await this.search(uri, 'track', 1);
      if (!top) throw new Error(`No track found for "${what}".`);
      uri = top.uri; label = `${top.name} — ${top.artist}`;
    }
    await this.api(`/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: 'POST' });
    return { ok: true, queued: label };
  }

  /** What's playing right now. */
  async current() {
    const j = await this.api('/me/player/currently-playing');
    if (!j || !j.item) return { playing: false };
    const t = j.item;
    return {
      playing: j.is_playing,
      track: t.name,
      artist: (t.artists || []).map((a: any) => a.name).join(', '),
      album: t.album?.name,
      art: t.album?.images?.[0]?.url,
      progressMs: j.progress_ms,
      durationMs: t.duration_ms,
      uri: t.uri,
    };
  }
}
