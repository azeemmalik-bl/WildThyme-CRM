// Scans content/ and generates assets/nav.json + assets/search-index.json.
// Run with: node build.js  (re-run any time files are added/removed from content/)
const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, 'content');
const ASSETS_DIR = path.join(__dirname, 'assets');
const HTML_EXT = new Set(['.html', '.htm']);

function extractTitle(html, fallback) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1].trim()) return decodeEntities(titleMatch[1].trim());
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match && h1Match[1].trim()) return decodeEntities(stripTags(h1Match[1]).trim());
  return fallback;
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ');
}

function decodeEntities(str) {
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function extractText(html) {
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const text = decodeEntities(stripTags(noScripts)).replace(/\s+/g, ' ').trim();
  return text.slice(0, 8000);
}

function extractLinks(html) {
  const links = [];
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!href || /^(https?:|mailto:|javascript:|tel:|#)/i.test(href)) continue;
    links.push(href.split('#')[0].split('?')[0]);
  }
  return links;
}

function resolveRelativeLink(fromDir, href) {
  try {
    return path.posix.normalize(path.posix.join(fromDir, decodeURIComponent(href)));
  } catch {
    return null;
  }
}

function titleCaseFromFilename(name) {
  const base = name.replace(/\.[^.]+$/, '');
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function walk(dir, relDir, breadcrumb, searchIndex) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const children = [];
  const fileBuffer = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = path.join(relDir, entry.name).split(path.sep).join('/');

    if (entry.isDirectory()) {
      const node = walk(fullPath, relPath, [...breadcrumb, entry.name], searchIndex);
      if (node.children.length > 0) {
        const dirNode = {
          type: 'dir',
          name: titleCaseFromFilename(entry.name),
          count: node.count,
          children: node.children,
        };
        if (node.directFile) dirNode.directFile = node.directFile;
        children.push(dirNode);
      }
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (!HTML_EXT.has(ext)) continue;
      const html = fs.readFileSync(fullPath, 'utf8');
      const filenameTitle = titleCaseFromFilename(entry.name);
      fileBuffer.push({
        relPath,
        rawTitle: extractTitle(html, filenameTitle),
        filenameTitle,
        text: extractText(html),
        links: extractLinks(html),
      });
    }
  }

  // Old hand-built sites often reuse a single copy-pasted <title> across every
  // page in a folder (e.g. a whole episode guide titled just "Episode Guide").
  // When a title isn't unique within its own folder it can't tell pages apart
  // in the nav, so fall back to a filename-derived title for those.
  const titleCounts = new Map();
  fileBuffer.forEach(({ rawTitle }) => {
    const key = rawTitle.toLowerCase();
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  });

  // Many of these folders are one "hub" page (an index/menu) linking out to
  // every other page in the folder, with those pages rarely linking to each
  // other. Showing every page as its own box duplicates the hub's own
  // navigation, so detect the hub (the file linking to the most siblings) and
  // hide the pages it links to — they stay reachable through the hub page's
  // links and remain fully searchable, just not shown as separate boxes.
  const siblingPaths = new Set(fileBuffer.map((f) => f.relPath));
  fileBuffer.forEach((f) => {
    const targets = new Set();
    f.links.forEach((href) => {
      const resolved = resolveRelativeLink(relDir, href);
      if (resolved && resolved !== f.relPath && siblingPaths.has(resolved)) targets.add(resolved);
    });
    f.linkTargets = targets;
  });

  let hub = null;
  if (fileBuffer.length >= 4) {
    const threshold = Math.max(3, Math.ceil(0.4 * (fileBuffer.length - 1)));
    hub = fileBuffer.reduce((best, f) => (!best || f.linkTargets.size > best.linkTargets.size ? f : best), null);
    if (!hub || hub.linkTargets.size < threshold) hub = null;
  }
  const hiddenPaths = hub ? hub.linkTargets : new Set();

  fileBuffer.forEach(({ relPath, rawTitle, filenameTitle, text }) => {
    const isDuplicate = titleCounts.get(rawTitle.toLowerCase()) > 1;
    const title = isDuplicate ? filenameTitle : rawTitle;
    const node = { type: 'file', name: title, file: relPath };
    if (hiddenPaths.has(relPath)) node.hidden = true;
    children.push(node);
    searchIndex.push({
      title,
      file: relPath,
      breadcrumb: breadcrumb.join(' / '),
      ancestry: [...breadcrumb],
      text,
    });
  });

  const count = children.reduce((sum, node) => sum + (node.type === 'dir' ? node.count : 1), 0);

  // If a folder's only visible item (after hub-hiding above) is a single
  // page, drilling into it just to show one box is a wasted click — let the
  // folder box open that page directly instead. This cascades through chains
  // of single-child subfolders too (e.g. a folder containing only a "Pages"
  // subfolder, which itself resolved to a single hub page).
  const visible = children.filter((node) => !(node.type === 'file' && node.hidden));
  let directFile = null;
  if (visible.length === 1) {
    if (visible[0].type === 'file') directFile = visible[0].file;
    else if (visible[0].type === 'dir' && visible[0].directFile) directFile = visible[0].directFile;
  }

  return { children, count, directFile };
}

// Manual entry-point overrides for top-level folders where the automatic
// "single visible item" detection doesn't apply (the folder has an Images
// subfolder alongside its pages, a hub page plus an orphan, or is a
// chronological diary that should simply start at its first/index page).
const ENTRY_OVERRIDES = {
  'Wild Thyme Garden Design': 'Wild-Thyme-Garden-Design/index.html',
  'Poirot Casts': '_ Poirot_Casts/Poirot_Casts.html',
  'Poirot Editions': '_ Poirot_Editions/Poirot_Editions.html',
  'Poirot Locations': '_ Poirot_Locations/Poirot_Locations.html',
  Almodovar: '_Almodovar/0.Index.html',
  'Argentina 1999': '_Argentina_1999/Pages/1.Buenos_Aires.html',
  'Book Illustration': '_Book_Illustration/0.index.html',
  'California 1991': '_California_1991/Pages/1.Itinerary.html',
  'Carry On Films': '_Carry_On_Films/Pages/0.Index.html',
  'Charles Dickens': '_Charles-Dickens/Pages/0_Index.html',
  'China 1994': '_China_1994/1.Beijing.html',
  'Egypt 2008': '_Egypt_2008/Pages/1.Itinerary.html',
  'Florida 1997': '_Florida_1997/1.Arrival.html',
  'Handel Operas': '_Handel_Operas/Pages/Index.html',
  'India 2004': '_India_2004/Pages/0.Itinerary.html',
  'James Bond': '_James_Bond/Pages/0.Index.html',
  'Machu Picchu 2009': '_Machu_Picchu_2009/Pages/0.Itinerary.html',
  'Miss Marple': '_Miss_Marple/Pages/0_Index.html',
  'New York 2003': '_New_York_2003/Pages/1.New_York.html',
  'New Zealand 2016': '_New-Zealand_2016/Pages/Itinerary.html',
  'Ridley Scott': '_Ridley_Scott/0.Index.html',
  'Simon Raven': '_Simon_Raven/Pages/0_Index.html',
  'The Pallisers': '_The_Pallisers/Pages/0_Index.html',
  'Turkey 2010': '_Turkey_2010/1.Istanbul.html',
  'Vacation Blog': '_Vacation-Blog/Vacation-Blog.html',
  'Twin Peaks': '_Twin_Peaks/Twin_Peaks_Homepage.html',
};

function applyEntryOverrides(children, searchIndex) {
  const validFiles = new Set(searchIndex.map((d) => d.file));
  children.forEach((node) => {
    if (node.type !== 'dir') return;
    const override = ENTRY_OVERRIDES[node.name];
    if (!override) return;
    if (!validFiles.has(override)) {
      console.warn(`Entry override for "${node.name}" points to a missing file: ${override}`);
      return;
    }
    node.directFile = override;
  });
}

function main() {
  if (!fs.existsSync(CONTENT_DIR)) {
    console.error(`content/ directory not found at ${CONTENT_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const searchIndex = [];
  const { children } = walk(CONTENT_DIR, '', [], searchIndex);

  const pinnedIndex = children.findIndex((n) => n.type === 'dir' && n.name === 'Wild Thyme Garden Design');
  if (pinnedIndex > 0) children.unshift(children.splice(pinnedIndex, 1)[0]);

  applyEntryOverrides(children, searchIndex);

  fs.writeFileSync(path.join(ASSETS_DIR, 'nav.json'), JSON.stringify(children, null, 2));
  fs.writeFileSync(path.join(ASSETS_DIR, 'search-index.json'), JSON.stringify(searchIndex, null, 2));

  const fileCount = searchIndex.length;
  console.log(`Indexed ${fileCount} HTML document(s) from content/.`);
  if (fileCount === 0) {
    console.log('No HTML files found yet — copy your client\'s files into content/ and re-run.');
  }
}

main();
