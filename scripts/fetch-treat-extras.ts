/**
 * Enrichment script: re-scrapes Vancouver Ice Cream Festival vendor pages on
 * nomsmagazine.com to ADD the following to the existing dataset:
 *   - per-item photos (downloaded + resized into assets/treat-images/)
 *   - per-item stamp counts (Flavour.stamps)
 *   - per-vendor neighborhood summary (Location.neighborhoods)
 *   - per-vendor "missions" (Location.missions)
 *
 * It generates assets/treatImages.ts (a static require-map for Metro).
 *
 * Run with: bunx tsx scripts/fetch-treat-extras.ts
 */

import * as cheerio from 'cheerio';
import { execFileSync } from 'child_process';
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'fs';
import { join } from 'path';

const INDEX_URL = 'https://nomsmagazine.com/vancouver-ice-cream-festival/';
const VENDOR_BASE = 'https://nomsmagazine.com/vancouver-ice-cream-festival/';
const MAGICK = '/opt/homebrew/bin/magick';
const RATE_LIMIT_MS = 250;

const ASSETS_DIR = join(__dirname, '..', 'assets');
const TREAT_IMAGES_DIR = join(ASSETS_DIR, 'treat-images');
const FLAVOURS_PATH = join(ASSETS_DIR, 'FlavourList.json');
const LOCATIONS_PATH = join(ASSETS_DIR, 'LocationList.json');
const TREAT_IMAGES_MODULE = join(ASSETS_DIR, 'treatImages.ts');

interface Mission {
  name: string;
  description: string;
}

// Decode HTML entities and strip tags, collapsing whitespace.
function decodeHtml(html: string): string {
  return html
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, "'")
    .replace(/&#038;/g, '&')
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8230;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalize a name for matching: lowercase, strip punctuation, collapse spaces.
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[–—]/g, '-') // en/em dash -> hyphen
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (data-enrichment script)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function getVendorSlugs(): Promise<string[]> {
  const html = await fetchText(INDEX_URL);
  const $ = cheerio.load(html);
  const slugs: string[] = [];
  $('a.icf-stamp').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/vancouver-ice-cream-festival\/([^/]+)\/?$/);
    if (m) slugs.push(m[1]);
  });
  return [...new Set(slugs)];
}

interface ParsedItem {
  name: string;
  stamps?: number;
  imageUrl?: string; // real photo url, only if photo div is --filled
}

interface ParsedVendor {
  name: string;
  neighborhoods?: string;
  items: ParsedItem[];
  missions: Mission[];
}

function parseVendorPage(html: string): ParsedVendor {
  const $ = cheerio.load(html);

  const name = $('.icfv-hero-name').first().text().trim();
  const neighborhoodsRaw = $('.icfv-hero-meta').first().text().trim();
  const neighborhoods = neighborhoodsRaw ? decodeHtml(neighborhoodsRaw) : undefined;

  const items: ParsedItem[] = [];
  $('.icfv-items-grid > .icfv-item').each((_, el) => {
    const itemName = decodeHtml($(el).find('.icfv-item-name').text());

    const stampTxt = $(el).find('.icfv-item-stamp').text();
    const stampMatch = stampTxt.match(/(\d+)/);
    const stamps = stampMatch ? parseInt(stampMatch[1], 10) : undefined;

    const photoDiv = $(el).find('.icfv-item-photo');
    let imageUrl: string | undefined;
    if (photoDiv.hasClass('icfv-item-photo--filled')) {
      const img = photoDiv.find('img');
      imageUrl = img.attr('data-lazy-src') || undefined;
      if (!imageUrl) {
        // Fallback to <noscript><img src="..."> real url
        const noscriptHtml = photoDiv.find('noscript').html() || '';
        const m = noscriptHtml.match(/src=["']([^"']+)["']/);
        if (m) imageUrl = m[1];
      }
      // Last resort: a non-placeholder src
      if (!imageUrl) {
        const src = img.attr('src');
        if (src && !src.startsWith('data:')) imageUrl = src;
      }
    }

    items.push({ name: itemName, stamps, imageUrl });
  });

  const missions: Mission[] = [];
  $('.icfv-mission').each((_, el) => {
    const mName = decodeHtml($(el).find('.icfv-mission-name').text());
    const mDesc = decodeHtml($(el).find('.icfv-mission-desc').text());
    if (mName) missions.push({ name: mName, description: mDesc });
  });

  return { name, neighborhoods, items, missions };
}

async function downloadAndResize(
  url: string,
  flavourId: number
): Promise<boolean> {
  const tmpPath = join(TREAT_IMAGES_DIR, `.tmp-${flavourId}`);
  const outPath = join(TREAT_IMAGES_DIR, `${flavourId}.jpg`);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (data-enrichment script)' },
    });
    if (!res.ok) {
      console.error(`  ! download failed HTTP ${res.status}: ${url}`);
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(tmpPath, buf);

    // Resize to max 800px long edge, strip metadata, quality 80.
    execFileSync(MAGICK, [
      tmpPath,
      '-resize',
      '800x800>',
      '-strip',
      '-quality',
      '80',
      outPath,
    ]);

    // Verify it's a valid jpg.
    const ident = execFileSync(MAGICK, ['identify', '-format', '%m', outPath])
      .toString()
      .trim();
    if (ident !== 'JPEG') {
      console.error(`  ! output not JPEG (${ident}) for id ${flavourId}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`  ! error processing image for id ${flavourId}: ${e}`);
    return false;
  } finally {
    try {
      if (existsSync(tmpPath)) execFileSync('/bin/rm', ['-f', tmpPath]);
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  if (!existsSync(TREAT_IMAGES_DIR)) {
    mkdirSync(TREAT_IMAGES_DIR, { recursive: true });
  }

  const flavoursDoc = JSON.parse(readFileSync(FLAVOURS_PATH, 'utf-8'));
  const locationsDoc = JSON.parse(readFileSync(LOCATIONS_PATH, 'utf-8'));
  const flavours: any[] = flavoursDoc.data;
  const locations: any[] = locationsDoc.data;

  // Location lookup by normalized name.
  const locByName = new Map<string, any>();
  for (const loc of locations) {
    locByName.set(normalizeName(loc.name), loc);
  }

  // Flavour lookup by (location id + normalized item name).
  const flavByKey = new Map<string, any>();
  for (const f of flavours) {
    flavByKey.set(`${f.location}::${normalizeName(f.name)}`, f);
  }

  const slugs = await getVendorSlugs();
  console.log(`Found ${slugs.length} vendor slugs\n`);

  let imagesDownloaded = 0;
  let stampsSet = 0;
  let neighborhoodsSet = 0;
  let vendorsWithMissions = 0;
  let totalMissions = 0;
  const failedImages: string[] = [];
  const unmatchedVendors: string[] = [];
  const unmatchedItems: string[] = [];

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    let html: string;
    try {
      html = await fetchText(`${VENDOR_BASE}${slug}/`);
    } catch (e) {
      console.error(`[${slug}] fetch failed: ${e}`);
      await sleep(RATE_LIMIT_MS);
      continue;
    }

    const parsed = parseVendorPage(html);

    // Match vendor to location by normalized name; fall back to index order.
    let loc = locByName.get(normalizeName(parsed.name));
    if (!loc) {
      loc = locations[i];
      unmatchedVendors.push(
        `${slug} (hero "${parsed.name}" -> fell back to index id ${loc?.id} "${loc?.name}")`
      );
    }
    if (!loc) {
      console.error(`[${slug}] no location match and no index fallback`);
      await sleep(RATE_LIMIT_MS);
      continue;
    }

    console.log(
      `[${slug}] ${parsed.name} -> loc#${loc.id} ${loc.name} | ${parsed.items.length} items, ${parsed.missions.length} missions`
    );

    // Neighborhoods
    if (parsed.neighborhoods) {
      loc.neighborhoods = parsed.neighborhoods;
      neighborhoodsSet++;
    }

    // Missions
    if (parsed.missions.length > 0) {
      loc.missions = parsed.missions;
      vendorsWithMissions++;
      totalMissions += parsed.missions.length;
    }

    // Items: stamps + images
    for (const item of parsed.items) {
      const key = `${loc.id}::${normalizeName(item.name)}`;
      const flav = flavByKey.get(key);
      if (!flav) {
        unmatchedItems.push(`loc#${loc.id} "${item.name}"`);
        continue;
      }
      if (item.stamps != null) {
        flav.stamps = item.stamps;
        stampsSet++;
      }
      if (item.imageUrl) {
        const ok = await downloadAndResize(item.imageUrl, flav.id);
        if (ok) {
          flav.image = `${flav.id}.jpg`;
          imagesDownloaded++;
          console.log(`    img id ${flav.id} <- ${item.imageUrl}`);
        } else {
          failedImages.push(`id ${flav.id}: ${item.imageUrl}`);
        }
      }
    }

    await sleep(RATE_LIMIT_MS);
  }

  // Write enriched JSON back, preserving formatting (2-space indent).
  writeFileSync(FLAVOURS_PATH, JSON.stringify(flavoursDoc, null, 2) + '\n');
  writeFileSync(LOCATIONS_PATH, JSON.stringify(locationsDoc, null, 2) + '\n');

  // Generate treatImages.ts from files actually on disk.
  const fileIds = readdirSync(TREAT_IMAGES_DIR)
    .map((f) => f.match(/^(\d+)\.jpg$/))
    .filter((m): m is RegExpMatchArray => m != null)
    .map((m) => parseInt(m[1], 10))
    .sort((a, b) => a - b);

  const lines = fileIds.map(
    (id) => `  ${id}: require('./treat-images/${id}.jpg'),`
  );
  const moduleContent = `// AUTO-GENERATED by scripts/fetch-treat-extras.ts — do not edit by hand.
export const treatImages: Record<number, number> = {
${lines.join('\n')}
};
`;
  writeFileSync(TREAT_IMAGES_MODULE, moduleContent);

  // Report
  console.log('\n=== Summary ===');
  console.log(`Items total: ${flavours.length}`);
  console.log(`Images downloaded: ${imagesDownloaded}`);
  console.log(`treat-images files on disk: ${fileIds.length}`);
  console.log(`treatImages.ts entries: ${fileIds.length}`);
  console.log(`Items with stamps set: ${stampsSet}`);
  console.log(`Vendors with neighborhoods: ${neighborhoodsSet}`);
  console.log(
    `Vendors with missions: ${vendorsWithMissions} (total missions: ${totalMissions})`
  );

  if (unmatchedVendors.length) {
    console.log(`\nVendors that fell back to index order:`);
    unmatchedVendors.forEach((v) => console.log(`  - ${v}`));
  }
  if (unmatchedItems.length) {
    console.log(`\nUnmatched items (no Flavour found):`);
    unmatchedItems.forEach((v) => console.log(`  - ${v}`));
  }
  if (failedImages.length) {
    console.log(`\nFailed image downloads:`);
    failedImages.forEach((v) => console.log(`  - ${v}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
