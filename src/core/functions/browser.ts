import path from 'node:path';
import { promises as fsp } from 'node:fs';
import puppeteer, { Browser, Page } from 'puppeteer';

/**
 * MANDATORY FUNCTION #2 — HEADLESS BROWSER
 *   + visible "show me" mode
 *   + CAPTCHA -> human hand-off
 * -----------------------------------------------------------------------
 * Runs HEADLESS by default (invisible automation). When a CAPTCHA is detected
 * it can automatically pop a REAL visible Chrome window so a human can solve it,
 * then resume automation once it's cleared.
 *
 * The trick that makes the hand-off seamless: a persistent `userDataDir`. Chrome
 * can't switch headless<->headful in-flight, so we relaunch — but because both
 * modes share the same profile, cookies/logins/session survive the swap and we
 * just re-navigate to the same URL to continue.
 */
export interface BrowserOptions {
  headless?: boolean;
  /** Persistent profile dir so logins + session survive a headless->visible swap. */
  userDataDir?: string;
  /** Called when a CAPTCHA is detected (e.g. ping the user on Telegram). */
  onCaptcha?: (info: { url: string }) => void;
  /**
   * Use a real installed browser channel (e.g. 'chrome') instead of the bundled
   * Chromium. Google sign-in refuses bundled/automation Chromium ("this browser
   * may not be secure"), so use 'chrome' for anything that logs into Google.
   */
  channel?: 'chrome' | 'chrome-beta' | 'chrome-canary' | 'chrome-dev';
  /** Explicit browser executable (e.g. Microsoft Edge's msedge.exe). Overrides channel. */
  executablePath?: string;
}

export class AgentBrowser {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private headless: boolean;
  private userDataDir: string;
  private onCaptcha?: (info: { url: string }) => void;
  private channel?: 'chrome' | 'chrome-beta' | 'chrome-canary' | 'chrome-dev';
  private executablePath?: string;

  /** Selectors that reliably indicate a CAPTCHA / bot-check widget. */
  private readonly captchaSelectors = [
    'iframe[src*="recaptcha"]',
    'iframe[title*="recaptcha" i]',
    'iframe[src*="hcaptcha"]',
    'iframe[src*="challenges.cloudflare.com"]', // Cloudflare Turnstile
    '.g-recaptcha',
    '.h-captcha',
    '#captcha',
    'form[action*="sorry/index"]', // Google "unusual traffic" interstitial
  ];

  /** Visible page text that indicates a bot-check even without a known widget. */
  private readonly captchaPhrases = [
    'unusual traffic',
    "i'm not a robot",
    'are you a robot',
    'verify you are human',
    "verify you're human",
    'complete the captcha',
    'security check',
    'confirm you are not a robot',
  ];

  constructor(opts: BrowserOptions = {}) {
    this.headless = opts.headless ?? true;
    // Default profile for automated browsing: dedicated dir owned ONLY by the
    // bundled Chromium. (The interactive/login browser pins '.browser-profile'
    // explicitly — mixing the installed Chrome's newer profile with bundled
    // Chromium makes Chromium refuse to launch.)
    this.userDataDir = opts.userDataDir ?? path.resolve('.browser-agent');
    this.onCaptcha = opts.onCaptcha;
    this.channel = opts.channel;
    this.executablePath = opts.executablePath;
  }

  get isOpen(): boolean {
    return this.browser !== null;
  }
  get visible(): boolean {
    return !this.headless;
  }

  private launchOptions() {
    return {
      headless: this.headless,
      userDataDir: this.userDataDir,
      // Prefer an explicit executable (Edge); else a channel (real Chrome); else bundled Chromium.
      ...(this.executablePath ? { executablePath: this.executablePath } : this.channel ? { channel: this.channel } : {}),
      // Hide the "controlled by automation" signals so Google sign-in behaves.
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--autoplay-policy=no-user-gesture-required',
        ...(this.headless ? [] : ['--start-maximized']),
      ],
      defaultViewport: this.headless ? { width: 1280, height: 800 } : null,
    };
  }

  /** Remove stale singleton/lock files a crashed Chrome can leave behind. */
  private async clearProfileLocks(): Promise<void> {
    const locks = ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    await Promise.all(
      locks.map((f) => fsp.rm(path.join(this.userDataDir, f), { force: true, recursive: true }).catch(() => {})),
    );
  }

  /** Launch, and if a stale profile lock kills it, clean up and retry once. */
  private async launchWithRecovery(): Promise<Browser> {
    try {
      return await puppeteer.launch(this.launchOptions());
    } catch (err) {
      console.warn('[browser] launch failed, clearing profile locks and retrying:', (err as Error).message);
      await this.clearProfileLocks();
      return puppeteer.launch(this.launchOptions());
    }
  }

  private async ensure(): Promise<Page> {
    if (!this.browser) {
      this.browser = await this.launchWithRecovery();
      this.browser.on('disconnected', () => {
        this.browser = null;
        this.page = null;
      });
    }
    if (!this.page || this.page.isClosed()) {
      const pages = await this.browser.pages();
      this.page = pages[0] ?? (await this.browser.newPage());
    }
    return this.page;
  }

  /** Force a VISIBLE window (relaunches headful; session preserved via profile). */
  async showWindow(): Promise<void> {
    const resumeUrl = this.page && !this.page.isClosed() ? this.page.url() : undefined;
    if (this.browser && this.headless) {
      await this.close();
    }
    this.headless = false;
    await this.ensure();
    if (resumeUrl && resumeUrl !== 'about:blank') {
      await this.goto(resumeUrl);
    }
  }

  /** Go back HEADLESS (relaunch invisibly), preserving the current URL/session. */
  async hideWindow(): Promise<void> {
    const resumeUrl = this.page && !this.page.isClosed() ? this.page.url() : undefined;
    if (this.browser && !this.headless) {
      await this.close();
    }
    this.headless = true;
    await this.ensure();
    if (resumeUrl && resumeUrl !== 'about:blank') {
      await this.goto(resumeUrl);
    }
  }

  async goto(url: string): Promise<void> {
    const page = await this.ensure();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  }

  /**
   * Navigate AND auto-handle a CAPTCHA: if one is detected while headless, the
   * window is opened for you to solve, then automation resumes. This is the
   * method agents should use for any site that might bot-check them.
   */
  async gotoSafe(url: string): Promise<void> {
    await this.goto(url);
    if (await this.hasCaptcha()) {
      await this.solveCaptchaWithHuman();
    }
  }

  async fill(selector: string, value: string): Promise<void> {
    const page = await this.ensure();
    await page.waitForSelector(selector, { timeout: 15_000 });
    await page.type(selector, value, { delay: 20 });
  }

  async click(selector: string): Promise<void> {
    const page = await this.ensure();
    await page.waitForSelector(selector, { timeout: 15_000 });
    await page.click(selector);
  }

  async title(): Promise<string> {
    const page = await this.ensure();
    return page.title();
  }

  async screenshot(filePath: string): Promise<string> {
    const page = await this.ensure();
    await page.screenshot({ path: filePath as `${string}.png`, fullPage: false });
    return filePath;
  }

  async extractDom(): Promise<string> {
    const page = await this.ensure();
    return page.content();
  }

  async extractText(): Promise<string> {
    const page = await this.ensure();
    return page.evaluate(() => document.body.innerText);
  }

  /**
   * Open a URL (following any redirect — e.g. a Google News link to the real
   * publisher) and extract the main readable article text. Prefers <article>/
   * <main>, strips nav/ads, and falls back to the longest paragraph run.
   */
  async readArticle(url: string): Promise<{ title: string; url: string; text: string }> {
    const page = await this.ensure();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // Google News interstitials JS-redirect to the publisher; give that a beat.
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 12_000 }).catch(() => {});
    return page.evaluate(() => {
      const root =
        document.querySelector('article') ||
        document.querySelector('main') ||
        document.querySelector('[role="main"]') ||
        document.body;
      root.querySelectorAll('script,style,nav,header,footer,aside,form,figure,noscript,iframe').forEach((e) => e.remove());
      const paras = Array.from(root.querySelectorAll('p'))
        .map((p) => (p as HTMLElement).innerText.trim())
        .filter((t) => t.length > 40);
      const text = (paras.length ? paras.join('\n\n') : (root as HTMLElement).innerText).slice(0, 9000);
      return { title: document.title, url: location.href, text };
    });
  }

  /** Rich snapshot: text + interactive elements on the page (for step-by-step control). */
  async readInteractive(): Promise<unknown> {
    const page = await this.ensure();
    return page.evaluate(() => {
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      };
      const links = Array.from(document.querySelectorAll('a[href]'))
        .filter(visible)
        .slice(0, 40)
        .map((a) => ({ text: (a as HTMLElement).innerText.trim().slice(0, 70), href: (a as HTMLAnchorElement).href }))
        .filter((l) => l.text);
      const buttons = Array.from(document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]'))
        .filter(visible)
        .slice(0, 30)
        .map((b) => ((b as HTMLElement).innerText || (b as HTMLInputElement).value || '').trim().slice(0, 60))
        .filter(Boolean);
      const inputs = Array.from(document.querySelectorAll('input,textarea,select'))
        .filter(visible)
        .slice(0, 25)
        .map((i) => ({
          tag: i.tagName.toLowerCase(),
          type: (i as HTMLInputElement).type || 'text',
          name: (i as HTMLInputElement).name || i.id || '',
          placeholder: (i as HTMLInputElement).placeholder || '',
        }));
      return { title: document.title, url: location.href, text: document.body.innerText.slice(0, 3000), links, buttons, inputs };
    });
  }

  /** Click the first visible element whose text/label contains `text`. */
  async clickByText(text: string): Promise<boolean> {
    const page = await this.ensure();
    const clicked = await page.evaluate((t: string) => {
      const needle = t.toLowerCase();
      const els = Array.from(
        document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"],[onclick]'),
      );
      const target = els.find(
        (e) => ((e as HTMLElement).innerText || (e as HTMLInputElement).value || '').trim().toLowerCase().includes(needle),
      );
      if (target) {
        (target as HTMLElement).scrollIntoView({ block: 'center' });
        (target as HTMLElement).click();
        return true;
      }
      return false;
    }, text);
    if (clicked) await page.waitForNetworkIdle({ timeout: 8000 }).catch(() => {});
    return clicked;
  }

  /** Press a key (e.g. 'Enter') on the focused element. */
  async press(key: string): Promise<void> {
    const page = await this.ensure();
    await page.keyboard.press(key as Parameters<typeof page.keyboard.press>[0]);
    await page.waitForNetworkIdle({ timeout: 8000 }).catch(() => {});
  }

  async evaluate<T>(fn: () => T): Promise<T> {
    const page = await this.ensure();
    return page.evaluate(fn) as Promise<T>;
  }

  // ── CAPTCHA handling ──────────────────────────────────────────────────────

  /** Does the current page appear to be showing a CAPTCHA / bot-check? */
  async hasCaptcha(): Promise<boolean> {
    const page = await this.ensure();
    const bySelector = await page
      .evaluate((sels) => sels.some((s) => document.querySelector(s) !== null), this.captchaSelectors)
      .catch(() => false);
    if (bySelector) return true;

    const text = (await page.evaluate(() => document.body?.innerText || '').catch(() => '')).toLowerCase();
    return this.captchaPhrases.some((p) => text.includes(p));
  }

  /**
   * THE HAND-OFF. If a CAPTCHA is up and we're headless, relaunch a visible
   * window (same profile => same session) on the same URL, notify via onCaptcha,
   * then poll until the human clears it. Returns true if solved, false on timeout.
   */
  async solveCaptchaWithHuman(opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<boolean> {
    const timeoutMs = opts.timeoutMs ?? 180_000; // 3 min for the human
    const pollMs = opts.pollMs ?? 2_000;

    const page = await this.ensure();
    const url = page.url();
    console.warn(`[browser] 🧩 CAPTCHA detected at ${url}`);
    this.onCaptcha?.({ url });

    const startedHeadless = this.headless;
    if (this.headless) {
      console.warn('[browser] Opening a visible window so you can solve it...');
      await this.showWindow(); // preserves session, re-navigates to `url`
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await this.hasCaptcha())) {
        console.log('[browser] ✅ CAPTCHA cleared — resuming automation.');
        // Pop-up → solved → vanish: go back headless if we escalated from it.
        if (startedHeadless) await this.hideWindow().catch(() => {});
        return true;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    console.warn('[browser] ⌛ CAPTCHA still present after timeout — giving up for now.');
    if (startedHeadless) await this.hideWindow().catch(() => {});
    return false;
  }

  /** Release the browser process (closes the visible window). */
  async close(): Promise<void> {
    await this.page?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.page = null;
    this.browser = null;
  }
}
