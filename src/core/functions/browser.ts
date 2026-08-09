import puppeteer, { Browser, Page } from 'puppeteer';

/**
 * MANDATORY FUNCTION #2 — HEADLESS BROWSER
 * ----------------------------------------
 * Every agent gets a lazily-launched headless browser it can use to navigate,
 * fill forms, click, and extract rendered DOM content.
 *
 * Puppeteer is used here for its light footprint. To swap in Playwright,
 * implement the same `AgentBrowser` surface against `playwright.chromium`.
 */
export class AgentBrowser {
  private browser: Browser | null = null;
  private page: Page | null = null;

  private async ensure(): Promise<Page> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    if (!this.page) {
      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1280, height: 800 });
    }
    return this.page;
  }

  /** Navigate to a URL and wait for the network to settle. */
  async goto(url: string): Promise<void> {
    const page = await this.ensure();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
  }

  /** Type text into the element matched by `selector`. */
  async fill(selector: string, value: string): Promise<void> {
    const page = await this.ensure();
    await page.waitForSelector(selector, { timeout: 15_000 });
    await page.type(selector, value, { delay: 20 });
  }

  /** Click the element matched by `selector`. */
  async click(selector: string): Promise<void> {
    const page = await this.ensure();
    await page.waitForSelector(selector, { timeout: 15_000 });
    await page.click(selector);
  }

  /** Extract the fully rendered DOM content. */
  async extractDom(): Promise<string> {
    const page = await this.ensure();
    return page.content();
  }

  /** Extract visible text (innerText of <body>). */
  async extractText(): Promise<string> {
    const page = await this.ensure();
    return page.evaluate(() => document.body.innerText);
  }

  /** Run an arbitrary DOM query in-page and return a serializable result. */
  async evaluate<T>(fn: () => T): Promise<T> {
    const page = await this.ensure();
    return page.evaluate(fn) as Promise<T>;
  }

  /** Release the browser process. Call in cleanup/shutdown. */
  async close(): Promise<void> {
    await this.page?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.page = null;
    this.browser = null;
  }
}
