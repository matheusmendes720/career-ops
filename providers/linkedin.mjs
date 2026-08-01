// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// LinkedIn Jobs provider — uses Playwright with session cookies to scrape
// job listings. Requires LINKEDIN_LI_AT and LINKEDIN_JSESSIONID env vars.

import { chromium } from 'playwright-core';

const LINKEDIN_JOBS_URL_RE = /linkedin\.com\/jobs\/view\//;
const LINKEDIN_SEARCH_BASE = 'https://www.linkedin.com/jobs/search';

/**
 * @param {string} url
 * @returns {Promise<Array<{title: string, url: string, company: string, location: string, postedAt: string|null}>>}
 */
async function scrapeLinkedInJobs(url) {
  const browser = await chromium.launch({ headless: true });
  let page;

  try {
    const context = await browser.newContext();
    page = await context.newPage();

    const cookies = [];
    if (process.env.LINKEDIN_LI_AT) {
      cookies.push({
        name: 'li_at',
        value: process.env.LINKEDIN_LI_AT,
        domain: '.linkedin.com',
        path: '/',
      });
    }
    if (process.env.LINKEDIN_JSESSIONID) {
      cookies.push({
        name: 'JSESSIONID',
        value: process.env.LINKEDIN_JSESSIONID,
        domain: '.linkedin.com',
        path: '/',
      });
    }
    if (cookies.length > 0) {
      await context.addCookies(cookies);
    }

    await page.goto(url, { timeout: 20000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); // allow JS to render job cards

    // Use page.evaluate for fast, synchronous DOM extraction
    const jobs = await page.evaluate(() => {
      const cards = document.querySelectorAll('.job-card-container');
      return Array.from(cards).map(card => {
        const titleEl =
          card.querySelector('.job-card-list__title--link') ||
          card.querySelector('a[href*="/jobs/view"]') ||
          card.querySelector('.job-card-list__title');
        const companyEl =
          card.querySelector('.job-card-container__company-name') ||
          card.querySelector('.artdeco-entity-lockup__subtitle') ||
          card.querySelector('.t-16');
        const locationEl =
          card.querySelector('.job-card-container__metadata-item') ||
          card.querySelector('.t-14');
        const rawHref = titleEl?.href || '';
        const jobUrl = rawHref.startsWith('/')
          ? 'https://www.linkedin.com' + rawHref
          : rawHref.startsWith('http')
          ? rawHref
          : '';
        return {
          title: titleEl?.textContent?.trim() || '',
          url: jobUrl,
          company: companyEl?.textContent?.trim() || '',
          location: locationEl?.textContent?.trim() || '',
          postedAt: null,
        };
      }).filter(j => j.title && j.url);
    });

    return jobs;
  } finally {
    if (page) await page.close();
    await browser.close();
  }
}

/** @type {Provider} */
export default {
  id: 'linkedin',

  detect(entry) {
    if (!entry.careers_url && !entry.search_url) return null;
    const url = entry.careers_url || entry.search_url || '';
    if (url.includes('linkedin.com/jobs')) {
      return { url };
    }
    return null;
  },

  async fetch(entry, ctx) {
    const baseUrl =
      entry.search_url ||
      entry.careers_url ||
      `${LINKEDIN_SEARCH_BASE}/?keywords=${encodeURIComponent(entry.title_filter?.positive?.[0] || 'engineer')}`;

    const jobs = await scrapeLinkedInJobs(baseUrl);
    return jobs;
  },
};
