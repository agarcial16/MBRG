// The real browser of the capture service (spec 038 FR-725): chrome-headless-shell driven by puppeteer-core. The only module that imports
// puppeteer. It starts one browser per `launch` and opens one page per shot; the page is the viewer's capture mode, which sets
// `data-capture` on the document to "ready" (the frame is drawn) or "error". Nothing here is covered by tests that start a browser: the
// service around it is tested with a fake, and the real run is the measured one (PROGRESS).
import puppeteer from 'puppeteer-core';
import type { BrowserDriver, BrowserSession } from './capture';

/** What the page says once it has decided, read in the page itself (a string: the bot's code has no DOM types). */
const SIGNAL = "document.documentElement.dataset.capture === 'ready' || document.documentElement.dataset.capture === 'error'";
const READ = "document.documentElement.dataset.capture";

export function createChromeDriver(executablePath: string): BrowserDriver {
  return {
    async launch(): Promise<BrowserSession> {
      const browser = await puppeteer.launch({
        executablePath,
        headless: 'shell',
        args: ['--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
      });
      return {
        async shoot(shot) {
          const page = await browser.newPage();
          try {
            await page.setViewport({ width: shot.width, height: shot.height, deviceScaleFactor: 1 });
            await page.goto(shot.url, { waitUntil: 'domcontentloaded', timeout: shot.timeoutMs });
            await page.waitForFunction(SIGNAL, { timeout: shot.timeoutMs });
            if ((await page.evaluate(READ)) !== 'ready') throw new Error('capture-error');
            return await page.screenshot({ type: 'png' });
          } finally {
            await page.close().catch(() => undefined);
          }
        },
        close: () => browser.close(),
      };
    },
  };
}
