/**
 * Scraper for the Vancouver Ice Cream Festival 2026 dataset (nomsmagazine.com).
 *
 * Parses the festival index page for vendor sub-page URLs, scrapes each vendor
 * page for vendor details / stores / items, geocodes store addresses (reusing
 * coordinates from the existing dataset where possible, otherwise Nominatim),
 * and writes assets/LocationList.json + assets/FlavourList.json.
 *
 * Run with: bunx tsx scripts/fetch-icf-data.ts
 */

import * as cheerio from 'cheerio';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const INDEX_URL = 'https://nomsmagazine.com/vancouver-ice-cream-festival/';
const USER_AGENT = 'vyf-icecream-festival/1.0';
const VERSION = '2026.icf';

// Festival runs June 19 – August 3, 2026.
const FESTIVAL_START = '2026-06-19T08:00:00Z';
const FESTIVAL_END = '2026-08-03T08:00:00Z';
const FESTIVAL_YEAR = 2026;
const FALLBACK_POINT: [number, number] = [49.2827, -123.1207]; // Vancouver downtown

const locationsPath = join(__dirname, '..', 'assets', 'LocationList.json');
const flavoursPath = join(__dirname, '..', 'assets', 'FlavourList.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decodeHtml(html: string): string {
  return html
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#038;/g, '&')
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Month-name parsing for item availability windows, e.g. "June 19 to July 11".
const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function parseDateToISO(monthName: string, day: number): string {
  const month = MONTHS[monthName.toLowerCase()];
  if (month === undefined) return FESTIVAL_START;
  // Build a UTC date at 08:00:00Z to match the existing dataset convention.
  const d = new Date(Date.UTC(FESTIVAL_YEAR, month, day, 8, 0, 0));
  return d.toISOString().replace('.000Z', 'Z');
}

function parseWindow(window: string): { startDate: string; endDate: string } {
  // e.g. "June 19 to July 11"
  const m = window.match(
    /([A-Za-z]+)\s+(\d{1,2})\s+to\s+([A-Za-z]+)\s+(\d{1,2})/i
  );
  if (m) {
    return {
      startDate: parseDateToISO(m[1], parseInt(m[2], 10)),
      endDate: parseDateToISO(m[3], parseInt(m[4], 10)),
    };
  }
  // Single date e.g. "June 19" -> treat as start, default festival end.
  const single = window.match(/([A-Za-z]+)\s+(\d{1,2})/);
  if (single) {
    return {
      startDate: parseDateToISO(single[1], parseInt(single[2], 10)),
      endDate: FESTIVAL_END,
    };
  }
  return { startDate: FESTIVAL_START, endDate: FESTIVAL_END };
}

// Normalize the leading street part of an address for coord reuse matching.
// "2150 Fir St, Vancouver, BC V6J 3B5" -> "2150 fir"
function addressKey(address: string): string | null {
  const firstPart = address.split(',')[0].trim().toLowerCase();
  const m = firstPart.match(/^(\d+)\s+(.+)$/);
  if (!m) return null;
  const num = m[1];
  // Strip street-type suffixes and punctuation to maximize matches.
  const street = m[2]
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|way|boulevard|blvd|place|pl|lane|ln|court|crescent|cres|highway|hwy)\b\.?/gi, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${num} ${street}`.trim();
}

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

interface OldStore {
  address: string;
  point: [number, number];
}

function buildCoordReuseMap(): Map<string, [number, number]> {
  const map = new Map<string, [number, number]>();
  try {
    const old = JSON.parse(readFileSync(locationsPath, 'utf-8'));
    for (const loc of old.data) {
      for (const store of loc.stores ?? []) {
        if (!store.address || !Array.isArray(store.point) || store.point.length !== 2) continue;
        const key = addressKey(store.address);
        if (key && !map.has(key)) map.set(key, store.point as [number, number]);
      }
    }
  } catch (e) {
    console.warn('Could not read existing LocationList for coord reuse:', e);
  }
  return map;
}

async function geocodeQuery(query: string): Promise<[number, number] | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const data = (await res.json()) as { lat: string; lon: string }[];
    if (data.length === 0) return null;
    return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  } catch {
    return null;
  }
}

// Build progressively-simplified query variants so unit/suite prefixes (which
// Nominatim often can't resolve) don't force a fallback. Tries the full address
// first, then variants with the unit prefix stripped, then a postal-code query.
function geocodeVariants(address: string): string[] {
  const variants = new Set<string>();
  variants.add(address);

  // Strip a leading "Unit 108-223 ..." / "108-223 ..." / "#202B ..." unit prefix,
  // keeping the civic street number that follows the dash.
  const noUnit = address
    .replace(/^\s*(unit|suite|ste\.?|#)\s*[\w]+\s*[-–]\s*/i, '')
    .replace(/^\s*\d+\s*[-–]\s*(?=\d)/, '')
    .replace(/\s+#\s*\w+/i, '');
  if (noUnit !== address) variants.add(noUnit);

  // Postal-code-anchored query (very reliable in Canada).
  const postal = address.match(/[A-Z]\d[A-Z]\s*\d[A-Z]\d/i);
  if (postal) {
    const cityMatch = address.match(/,\s*([^,]+),\s*BC/i);
    const city = cityMatch ? cityMatch[1].trim() : 'Vancouver';
    variants.add(`${postal[0]}, ${city}, BC, Canada`);
  }

  return [...variants];
}

async function geocode(address: string): Promise<[number, number] | null> {
  const variants = geocodeVariants(address);
  for (let i = 0; i < variants.length; i++) {
    const point = await geocodeQuery(variants[i]);
    if (point) return point;
    // Respect Nominatim's 1 req/sec between attempts.
    if (i < variants.length - 1) await sleep(1100);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scraping
// ---------------------------------------------------------------------------

interface ScrapedStore {
  name: string; // neighborhood label
  address: string;
  hours: string;
}

interface ScrapedItem {
  name: string;
  description: string;
  price: string;
  startDate: string;
  endDate: string;
  tags: string[];
}

interface ScrapedVendor {
  name: string;
  description: string;
  neighborhoods: string;
  website?: string;
  instagram?: string;
  stores: ScrapedStore[];
  items: ScrapedItem[];
  slug: string;
}

function parseVendorSlugs(indexHtml: string): string[] {
  const $ = cheerio.load(indexHtml);
  const slugs = new Set<string>();
  $('a.icf-stamp').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const m = href.match(/vancouver-ice-cream-festival\/([^/]+)\/?$/);
    if (m && m[1]) slugs.add(m[1]);
  });
  return [...slugs];
}

function parseVendor(html: string, slug: string): ScrapedVendor {
  const $ = cheerio.load(html);

  const name = decodeHtml($('.icfv-hero-name').first().html() || slug);
  const description = decodeHtml($('.icfv-hero-tagline').first().html() || '');
  const neighborhoods = decodeHtml($('.icfv-hero-meta').first().html() || '');

  // Items
  const items: ScrapedItem[] = [];
  $('.icfv-item').each((_, el) => {
    const $el = $(el);
    const itemName = decodeHtml($el.find('.icfv-item-name').first().html() || '');
    if (!itemName) return;
    const itemDesc = decodeHtml($el.find('.icfv-item-desc').first().html() || '');
    const price = decodeHtml($el.find('.icfv-item-price').first().text() || '');
    const window = decodeHtml($el.find('.icfv-item-window').first().text() || '');
    const { startDate, endDate } = window
      ? parseWindow(window)
      : { startDate: FESTIVAL_START, endDate: FESTIVAL_END };
    const tags: string[] = [];
    $el.find('.icfv-item-pill').each((_, p) => {
      const t = decodeHtml($(p).text());
      if (t) tags.push(t);
    });
    items.push({ name: itemName, description: itemDesc, price, startDate, endDate, tags });
  });

  // Locations / contact info.
  //
  // The "Plan Your Visit" section lays out one or more .icfv-loc-card. Layouts vary:
  //  - Multi-location vendors: each store is its own card (with .icfv-loc-num +
  //    neighborhood label + Address/Hours rows), and Website/Instagram live in
  //    separate cards.
  //  - Single-location vendors: one card holds Address + Hours + Website +
  //    Instagram rows together.
  // So we classify each card by the row labels it actually contains: a card with
  // an Address row is a STORE; Website/Instagram rows (anywhere) populate contact
  // info. This is robust to both layouts.
  const stores: ScrapedStore[] = [];
  let website: string | undefined;
  let instagram: string | undefined;

  $('.icfv-loc-card').each((_, el) => {
    const $el = $(el);

    // Neighborhood label (strip the numeric badge if present).
    const labelClone = $el.find('.icfv-loc-label').first().clone();
    labelClone.find('.icfv-loc-num').remove();
    const storeName = decodeHtml(labelClone.text());

    let address = '';
    let hours = '';
    $el.find('.icfv-loc-row').each((_, row) => {
      const $row = $(row);
      const rowLabel = decodeHtml($row.find('.icfv-loc-row-label').first().text());
      const $val = $row.find('.icfv-loc-row-value').first();
      if (/address/i.test(rowLabel)) {
        // Address sits inside an <a>; .text() drops the anchor markup.
        address = decodeHtml($val.text());
      } else if (/hours/i.test(rowLabel)) {
        // Preserve multi-line hours: turn <br>/newlines into " / ".
        const rawVal = $val.html() || '';
        hours = decodeHtml(rawVal.replace(/<br\s*\/?>/gi, '\n')).replace(/\s*\n\s*/g, ' / ');
      } else if (/website/i.test(rowLabel) && !website) {
        const $a = $val.find('a').first();
        website = $a.attr('href') || decodeHtml($a.text());
      } else if (/instagram/i.test(rowLabel) && !instagram) {
        const $a = $val.find('a').first();
        // Existing dataset stored bare handles (no @).
        instagram = decodeHtml($a.text()).replace(/^@/, '') || $a.attr('href');
      }
    });

    if (address) stores.push({ name: storeName, address, hours });
  });

  return { name, description, neighborhoods, website, instagram, stores, items, slug };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const coordReuse = buildCoordReuseMap();
  console.log(`Loaded ${coordReuse.size} reusable coordinates from existing dataset.`);

  console.log('Fetching index page...');
  const indexHtml = await fetchText(INDEX_URL);
  const slugs = parseVendorSlugs(indexHtml);
  console.log(`Found ${slugs.length} vendor slugs.`);

  const vendors: ScrapedVendor[] = [];
  for (const slug of slugs) {
    try {
      const html = await fetchText(`${INDEX_URL}${slug}/`);
      const vendor = parseVendor(html, slug);
      vendors.push(vendor);
      console.log(`  [${slug}] ${vendor.name} — ${vendor.stores.length} stores, ${vendor.items.length} items`);
    } catch (e) {
      console.error(`  [${slug}] FAILED:`, e);
    }
    await sleep(250);
  }

  // Build Locations + geocode stores.
  let reusedCount = 0;
  let geocodedCount = 0;
  const fallbackAddresses: string[] = [];

  const locations: any[] = [];
  let locId = 1;
  // Map slug -> location id for flavour FK.
  const slugToLocId = new Map<string, number>();

  for (const vendor of vendors) {
    const stores: any[] = [];
    for (const s of vendor.stores) {
      let point: [number, number] | null = null;

      const key = addressKey(s.address);
      if (key && coordReuse.has(key)) {
        point = coordReuse.get(key)!;
        reusedCount++;
      } else {
        point = await geocode(s.address);
        if (point) {
          geocodedCount++;
          // Cache for any later duplicate address.
          if (key) coordReuse.set(key, point);
        } else {
          point = FALLBACK_POINT;
          fallbackAddresses.push(`${vendor.name} — ${s.address}`);
          console.warn(`  FALLBACK coord for: ${vendor.name} — ${s.address}`);
        }
        // Nominatim rate limit: 1 req/sec.
        await sleep(1100);
      }

      stores.push({
        address: s.address,
        hours: s.hours,
        point,
        name: s.name,
      });
    }

    const loc: any = {
      id: locId,
      name: vendor.name,
      description: vendor.description,
    };
    if (vendor.instagram) loc.instagram = vendor.instagram;
    if (vendor.website) loc.website = vendor.website;
    loc.stores = stores;

    locations.push(loc);
    slugToLocId.set(vendor.slug, locId);
    locId++;
  }

  // Build Flavours.
  const flavours: any[] = [];
  let flavId = 1;
  for (const vendor of vendors) {
    const ownerId = slugToLocId.get(vendor.slug)!;
    for (const item of vendor.items) {
      flavours.push({
        id: flavId++,
        name: item.name,
        startDate: item.startDate,
        endDate: item.endDate,
        description: item.description,
        price: item.price,
        location: ownerId,
        tags: item.tags,
      });
    }
  }

  writeFileSync(
    locationsPath,
    JSON.stringify({ version: VERSION, data: locations }, null, 2) + '\n'
  );
  writeFileSync(
    flavoursPath,
    JSON.stringify({ version: VERSION, data: flavours }, null, 2) + '\n'
  );

  console.log('\n=== Summary ===');
  console.log(`Vendors (locations): ${locations.length}`);
  console.log(`Items (flavours):    ${flavours.length}`);
  console.log(`Coords reused:       ${reusedCount}`);
  console.log(`Coords geocoded:     ${geocodedCount}`);
  console.log(`Coords fallback:     ${fallbackAddresses.length}`);
  if (fallbackAddresses.length) {
    console.log('Fallback addresses (need manual fix):');
    for (const a of fallbackAddresses) console.log(`  - ${a}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
