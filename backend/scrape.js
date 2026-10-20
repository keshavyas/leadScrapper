const { Parser } = require('json2csv');

const ON_VERCEL = !!process.env.VERCEL;
const MAX_LEADS = Number(process.env.MAX_LEADS) || (ON_VERCEL ? 30 : 100);
const CONCURRENCY = Number(process.env.CONCURRENCY) || 3;
const SCROLL_PASSES = ON_VERCEL ? 5 : 7;
const TIME_BUDGET_MS = ON_VERCEL ? 240000 : 600000; // stop opening listings, return what we have

const FEED = 'div[role="feed"]';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FIELDS = [
  'Business Name', 'Category', 'Rating', 'Reviews', 'Address', 'Phone', 'Website',
  'Plus Code', 'Located In', 'Opening Hours', 'Description', 'Latitude', 'Longitude', 'Google Maps URL',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const human = () => 1500 + Math.floor(Math.random() * 500);

async function launchBrowser() {
  if (ON_VERCEL) {
    const chromium = require('@sparticuz/chromium');
    const { chromium: pw } = require('playwright-core');
    return pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  }
  const { chromium: pw } = require('playwright-chromium');
  return pw.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });
}

async function scrapePlace(page, link) {
  await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('h1.DUwDvf', { timeout: 15000 });
  await sleep(700 + Math.floor(Math.random() * 600));

  const d = await page.evaluate(() => {
    const clean = (s) => (s || '').replace(/[\u00a0\u202f\s]+/g, ' ').trim();
    const text = (sel) => clean(document.querySelector(sel)?.innerText);
    const label = (sel) =>
      clean((document.querySelector(sel)?.getAttribute('aria-label') || '').replace(/^[^:]+:\s*/, ''));

    const rr = text('div.F7nice');
    const phoneEl = document.querySelector('button[data-item-id^="phone:tel:"]');
    const phone = phoneEl
      ? label('button[data-item-id^="phone:tel:"]') ||
        phoneEl.getAttribute('data-item-id').replace('phone:tel:', '')
      : '';
    const hours = [...document.querySelectorAll('table.eK4R0e tr')]
      .map((tr) => [...tr.querySelectorAll('td')].slice(0, 2).map((td) => clean(td.innerText)).filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' | ');

    return {
      name: text('h1.DUwDvf'),
      category: text('button.DkEaL'),
      rating: (rr.match(/^\d(?:\.\d)?/) || [''])[0],
      reviews: ((rr.match(/\(([\d,]+)\)/) || ['', ''])[1] || '').replace(/,/g, ''),
      address: label('button[data-item-id="address"]'),
      phone,
      website: document.querySelector('a[data-item-id="authority"]')?.href || '',
      plusCode: label('button[data-item-id="oloc"]'),
      locatedIn: label('button[data-item-id="locatedin"]'),
      hours,
      description: text('div.PYvSYb'),
    };
  });

  const m = link.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  return {
    'Business Name': d.name || link.name,
    Category: d.category,
    Rating: d.rating,
    Reviews: d.reviews,
    Address: d.address,
    Phone: d.phone,
    Website: d.website,
    'Plus Code': d.plusCode,
    'Located In': d.locatedIn,
    'Opening Hours': d.hours,
    Description: d.description,
    Latitude: m ? m[1] : '',
    Longitude: m ? m[2] : '',
    'Google Maps URL': link.href,
  };
}

module.exports = async function scrapeHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const { businessType, area, city } = req.body || {};
  if (![businessType, area, city].every((v) => typeof v === 'string' && v.trim())) {
    return res.status(400).json({ error: 'businessType, area and city are all required.' });
  }

  const query = `${businessType.trim()} in ${area.trim()}, ${city.trim()}`;
  const started = Date.now();
  let browser;

  try {
    browser = await launchBrowser();
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1366, height: 820 },
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
    });
    const page = await context.newPage();

    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    try {
      await page.click('button:has-text("Accept all")', { timeout: 3000 });
    } catch (_) {}

    try {
      await page.waitForSelector(FEED, { timeout: 20000 });
    } catch (_) {
      return res.status(404).json({
        error: `No results panel found for "${query}". Try a broader area, or Google may be blocking this server.`,
      });
    }

    for (let i = 0; i < SCROLL_PASSES; i++) {
      await page.evaluate((sel) => {
        const feed = document.querySelector(sel);
        if (feed) feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
      }, FEED);
      await sleep(human());
      const ended = await page.evaluate(
        (sel) => /reached the end of the list/i.test(document.querySelector(sel)?.innerText || ''),
        FEED
      );
      if (ended) break;
    }

    const found = await page.$$eval(`${FEED} a[href*="/maps/place/"]`, (as) =>
      as.map((a) => ({ href: a.href, name: (a.getAttribute('aria-label') || '').trim() }))
    );
    const seen = new Set();
    const links = found
      .filter((l) => {
        const key = l.href.split('?')[0];
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_LEADS);

    if (!links.length) {
      return res.status(404).json({ error: 'No listings found. Google may have changed its layout.' });
    }
    console.log(`[scrape] "${query}": ${links.length} listings, opening each...`);

    const queue = [...links];
    const rows = [];

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, links.length) }, async () => {
        const tab = await context.newPage();
        await tab.route('**/*', (route) =>
          ['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue()
        );
        while (queue.length && Date.now() - started < TIME_BUDGET_MS) {
          const link = queue.shift();
          try {
            rows.push(await scrapePlace(tab, link));
          } catch (err) {
            console.warn(`[scrape] detail failed for "${link.name}": ${err.message}`);
            rows.push({ 'Business Name': link.name, 'Google Maps URL': link.href });
          }
          await sleep(300 + Math.floor(Math.random() * 400));
        }
        await tab.close();
      })
    );

    const unique = [
      ...new Map(
        rows
          .filter((r) => r['Business Name'])
          .map((r) => [`${r['Business Name']}|${r.Address || ''}`.toLowerCase(), r])
      ).values(),
    ];

    const csv = new Parser({ fields: FIELDS }).parse(unique);
    const file = `${businessType}-${area}-${city}`.replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.csv';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('X-Lead-Count', String(unique.length));
    return res.status(200).send('\uFEFF' + csv);
  } catch (err) {
    console.error('[scrape] failed:', err);
    return res.status(500).json({ error: `Scraper crashed: ${err.message}` });
  } finally {
    if (browser) await browser.close();
  }
};