import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let browser: Browser | null = null;
let browserLaunch: Promise<Browser> | null = null;

/** Get or create a shared headless browser for rendered pages. */
export async function getBrowser(signal?: AbortSignal): Promise<Browser> {
  signal?.throwIfAborted();
  if (!browser || !browser.isConnected()) {
    browserLaunch ??= chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
      timeout: 30000,
    }).then((launched) => {
      browser = launched;
      return launched;
    }).finally(() => {
      browserLaunch = null;
    });
    await browserLaunch;
  }
  signal?.throwIfAborted();
  if (!browser) throw new Error("browser launch completed without a browser instance");
  return browser;
}

/** Create a fresh browser context with standard settings */
export async function createContext(signal?: AbortSignal): Promise<BrowserContext> {
  const b = await getBrowser(signal);
  const context = await b.newContext({
    userAgent: UA,
    locale: "en-GB",
    timezoneId: "Europe/London",
  });
  if (signal?.aborted) {
    await context.close().catch(() => undefined);
    signal.throwIfAborted();
  }
  return context;
}

/** Create a page with browser-compatible navigator settings. */
export async function createStealthPage(
  context: BrowserContext,
  signal?: AbortSignal,
): Promise<Page> {
  signal?.throwIfAborted();
  const page = await context.newPage();
  signal?.throwIfAborted();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  return page;
}

/** Fetch a page's rendered HTML through Playwright. */
export async function fetchRenderedHtml(
  url: string,
  waitSelector?: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const context = await createContext(signal);
  const closeOnAbort = (): void => {
    void context.close().catch(() => undefined);
  };
  signal?.addEventListener("abort", closeOnAbort, { once: true });

  try {
    signal?.throwIfAborted();
    const page = await createStealthPage(context, signal);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 10000 }).catch(() => {
        // Selector not found — continue with what we have
      });
    }

    signal?.throwIfAborted();
    return await page.content();
  } finally {
    signal?.removeEventListener("abort", closeOnAbort);
    await context.close().catch(() => undefined);
  }
}

/** Shut down the shared browser (call on process exit) */
export async function closeBrowser(): Promise<void> {
  const activeBrowser = browser;
  browser = null;
  if (activeBrowser) await activeBrowser.close();
}
