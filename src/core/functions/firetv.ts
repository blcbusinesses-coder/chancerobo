import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { env } from '../../config/env.js';

const execAsync = promisify(exec);

/**
 * FIRE TV CONTROL (via ADB)
 * -------------------------
 * Drives an Amazon Fire TV over the network using ADB. The TV must have
 * "ADB debugging" + "Apps from Unknown Sources" enabled, and the first connect
 * must be approved on the TV screen. IP comes from FIRETV_IP in .env.
 */
const KEYCODES: Record<string, number> = {
  home: 3, back: 4, up: 19, down: 20, left: 21, right: 22, select: 23, ok: 23, center: 23,
  enter: 66, menu: 82, search: 84,
  play_pause: 85, play: 126, pause: 127, stop: 86, next: 87, previous: 88,
  rewind: 89, fast_forward: 90, forward: 90,
  mute: 164, volume_up: 24, volume_down: 25, power: 26, wake: 224, sleep: 223,
};

const APPS: Record<string, string> = {
  youtube: 'com.amazon.firetv.youtube',
  netflix: 'com.netflix.ninja',
  'prime video': 'com.amazon.avod', prime: 'com.amazon.avod', 'amazon prime': 'com.amazon.avod',
  disney: 'com.disney.disneyplus', 'disney+': 'com.disney.disneyplus', 'disney plus': 'com.disney.disneyplus',
  hulu: 'com.hulu.plus',
  spotify: 'com.spotify.tv.android',
  'hbo max': 'com.wbd.stream', max: 'com.wbd.stream', hbo: 'com.wbd.stream',
  plex: 'com.plexapp.android',
  twitch: 'tv.twitch.android.app',
  paramount: 'com.cbs.ott', 'paramount+': 'com.cbs.ott',
  peacock: 'com.peacocktv.peacockandroid',
  pluto: 'tv.pluto.android',
};

export class FireTV {
  private adb = env.firetv.adbPath || path.resolve('.tools/platform-tools/adb.exe');

  get addr(): string {
    return `${env.firetv.ip}:5555`;
  }
  get configured(): boolean {
    return Boolean(env.firetv.ip);
  }
  static appList(): string[] {
    return Object.keys(APPS);
  }
  static keyList(): string[] {
    return Object.keys(KEYCODES);
  }

  private async run(args: string): Promise<string> {
    const { stdout, stderr } = await execAsync(`"${this.adb}" ${args}`, {
      timeout: 20_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return (stdout || stderr).trim();
  }

  /** Connect (idempotent). Approve the prompt on the TV the first time. */
  async connect(): Promise<string> {
    if (!this.configured) throw new Error('FIRETV_IP is not set in .env');
    return this.run(`connect ${this.addr}`);
  }

  private async shell(cmd: string): Promise<string> {
    await this.connect().catch(() => {});
    return this.run(`-s ${this.addr} shell ${cmd}`);
  }

  async status(): Promise<string> {
    await this.connect().catch(() => {});
    return this.run('devices');
  }

  /** Press a remote key by friendly name (home, up, down, select, play_pause, ...). */
  async key(name: string): Promise<string> {
    const code = KEYCODES[name.toLowerCase().replace(/\s+/g, '_')];
    if (code === undefined) throw new Error(`Unknown key "${name}". Options: ${FireTV.keyList().join(', ')}`);
    await this.shell(`input keyevent ${code}`);
    return `pressed ${name}`;
  }

  /** Launch an app by friendly name (netflix, youtube, ...) or a package id. */
  async launchApp(nameOrPkg: string): Promise<string> {
    const key = nameOrPkg.toLowerCase().trim();
    const pkg = APPS[key] || (nameOrPkg.includes('.') ? nameOrPkg : '');
    if (!pkg) throw new Error(`Unknown app "${nameOrPkg}". Known: ${FireTV.appList().join(', ')} (or pass a package id).`);
    await this.shell(`monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
    return `launched ${pkg}`;
  }

  /** Type text into the currently focused field (e.g. a search box). */
  async type(text: string): Promise<string> {
    const safe = text.replace(/["'`]/g, '').replace(/ /g, '%s');
    await this.shell(`input text "${safe}"`);
    return 'typed text';
  }

  /** Open a URL / deep link on the TV (e.g. a YouTube video URL). */
  async openUrl(url: string): Promise<string> {
    await this.shell(`am start -a android.intent.action.VIEW -d "${url}"`);
    return `opened ${url}`;
  }
}
