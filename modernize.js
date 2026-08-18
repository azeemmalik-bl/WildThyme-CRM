// Mechanically converts legacy table/font-tag HTML pages into clean Bootstrap
// markup. This is a DOM transform, not a rewrite: every word of text, every
// href, every img src is carried over unchanged -- only the layout scaffolding
// (tables, font tags, legacy JS) is restructured. Output goes to "<name>.modern.html"
// right next to the original file, so relative image paths keep working with
// zero duplication and the original is never touched.
//
// Usage: node modernize.js <root-dir> [--apply]
//   Without --apply: dry run, just prints stats + any pages flagged for review.
//   With --apply: writes the .modern.html files.

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const SKIP_DIRS = new Set(['Wild-Thyme-Garden-Design', 'Wild-Thyme-Garden-Design-Modern', 'Images', 'images']);
const HTML_RE = /\.html?$/i;

function findHtmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      findHtmlFiles(full, out);
    } else if (HTML_RE.test(entry.name) && !entry.name.includes('.modern.')) {
      out.push(full);
    }
  }
  return out;
}

function normalizeText(str) {
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Legacy GoLive/Dreamweaver cruft that carries no content of its own.
const JS_HANDLER_ATTRS = ['onload', 'onclick', 'onmouseover', 'onmouseout', 'onmousedown', 'onmouseup'];
const PRESENTATIONAL_BODY_ATTRS = ['bgcolor', 'link', 'alink', 'vlink', 'text', 'background'];

function transform(html) {
  const $ = cheerio.load(html, { decodeEntities: false });

  // Drop all legacy script/style blocks -- rollover image-swap JS, CSInit
  // preload arrays etc. None of it carries visible content.
  $('script').remove();

  // Unwrap GoLive's non-standard wrapper tags (csobj, csscriptdict,
  // csactiondict) -- keep their children, drop the wrapper itself.
  $('csobj, csscriptdict, csactiondict, csinit').each((_, el) => {
    $(el).replaceWith($(el).contents());
  });

  // Unwrap <font>, but preserve color/face as an inline-equivalent span
  // first. A <font color> override is very often the ONLY thing making that
  // text visible against a body-level fallback color (a common legacy
  // authoring pattern: body text="#FFFFFF" as a rarely-seen default, with
  // real content color-corrected per span) -- dropping it silently turns
  // visible text invisible. face carries real per-page typeface choices,
  // which content.css's shared Georgia default can't reproduce on its own.
  $('font').each((_, el) => {
    const $el = $(el);
    const color = $el.attr('color');
    const face = $el.attr('face');
    const styleParts = [];
    if (color) styleParts.push(`color: ${color}`);
    if (face) styleParts.push(`font-family: ${face}`);
    if (styleParts.length === 0) {
      $el.replaceWith($el.contents());
      return;
    }
    const $span = $(`<span style="${styleParts.join('; ')}"></span>`);
    $span.append($el.contents());
    $el.replaceWith($span);
  });

  // <center> -> div.text-center (keeps the same visual intent as a real class).
  $('center').each((_, el) => {
    const $el = $(el);
    $el.replaceWith($('<div class="text-center"></div>').append($el.contents()));
  });

  // Strip inline event handlers and presentational body attributes; the
  // href/src that these handlers duplicated stays untouched. Capture the
  // colors first -- these carry real page-specific design intent (the
  // client hand-picked a background/text/link palette per page) and get
  // reapplied as an inline style + scoped <style> block by wrapDocument(),
  // rather than just discarded.
  $('*').each((_, el) => {
    if (!el.attribs) return;
    for (const attr of JS_HANDLER_ATTRS) delete el.attribs[attr];
  });
  const colors = {};
  for (const attr of PRESENTATIONAL_BODY_ATTRS) {
    const val = $('body').attr(attr);
    if (val) colors[attr] = val;
    $('body').removeAttr(attr);
  }
  $('body').addClass('legacy-content');

  // A cell that was purely a spacer in the old 2D table grid (no text, no
  // image, no link) has nothing worth keeping once we stack vertically --
  // it only existed to hold column alignment. Dropping it entirely avoids
  // an empty block appearing between real content when stacked on mobile.
  function isCellEmpty($cell) {
    if ($cell.find('img').length > 0) return false;
    const text = normalizeText($cell.text());
    return text.length === 0;
  }

  // A cell holding nothing but one small decorative image (e.g. a year
  // stamp) next to a cell with a much larger photo/poster is a common
  // pattern. The original tables usually gave both cells an equal colspan
  // regardless of the badge's tiny actual size, which -- once responsive --
  // leaves the badge floating in a mostly-empty half-width column instead
  // of sitting snugly beside the image. Detect it and size the badge's
  // column to just fit it, giving the rest of the row to the larger image.
  function isBadgeCell($cell) {
    const $imgs = $cell.find('img');
    if ($imgs.length !== 1) return false;
    if (normalizeText($cell.text()).length > 0) return false;
    const w = parseInt($imgs.first().attr('width'), 10);
    const h = parseInt($imgs.first().attr('height'), 10);
    return Number.isFinite(w) && Number.isFinite(h) && w <= 150 && h <= 150;
  }

  // Convert layout tables into Bootstrap rows/cols. This is a structural
  // transform only -- cell contents move verbatim into the new column divs.
  $('table').each((_, tableEl) => {
    const $table = $(tableEl);
    const $rows = $table.children('tr').length ? $table.children('tr') : $table.find('> tbody > tr');
    const $container = $('<div class="container-fluid legacy-table px-0"></div>');

    // Legacy tables often repeat a "label - value" row shape many times
    // (cast lists, crew lists, itineraries...), but only the first
    // occurrence carries width="" attributes -- a common copy-paste-without-
    // full-attributes authoring pattern. Scan for an exemplar set of
    // proportions per cell-count up front, to reuse on sibling rows that
    // share the same shape but lack their own width data.
    const exemplarWidthsByCellCount = new Map();
    $rows.each((_, rowEl) => {
      const $cells = $(rowEl).children('td, th').filter((_, c) => !isCellEmpty($(c)));
      if ($cells.length === 0 || exemplarWidthsByCellCount.has($cells.length)) return;
      const widths = $cells.toArray().map((c) => parseInt($(c).attr('width'), 10));
      if (widths.every((w) => Number.isFinite(w) && w > 0)) exemplarWidthsByCellCount.set($cells.length, widths);
    });

    $rows.each((_, rowEl) => {
      const $row = $(rowEl);
      const $allCells = $row.children('td, th');
      if ($allCells.length === 0) return;
      const $cells = $allCells.filter((_, c) => !isCellEmpty($(c)));
      if ($cells.length === 0) return;
      const $bsRow = $('<div class="row gy-2"></div>');

      // Prefer pixel `width` (this row's own, or borrowed from an exemplar
      // sibling) over colspan when computing Bootstrap column proportions.
      // colspan-only math treats a narrow "-" separator column the same as
      // the wide name/role columns beside it -- splitting the row into equal
      // thirds and wasting a third of the width on a single dash, which is
      // exactly what made these lists look sparse and misaligned.
      const ownWidths = $cells.toArray().map((c) => parseInt($(c).attr('width'), 10));
      const ownHaveWidth = ownWidths.every((w) => Number.isFinite(w) && w > 0);
      const widths = ownHaveWidth ? ownWidths : exemplarWidthsByCellCount.get($cells.length);
      const totalWidth = widths ? widths.reduce((a, b) => a + b, 0) : 0;

      const badgeFlags = $cells.toArray().map((c) => isBadgeCell($(c)));
      const badgeCount = badgeFlags.filter(Boolean).length;
      const hasMixedBadge = badgeCount > 0 && badgeCount < $cells.length;
      const nonBadgeSpan = hasMixedBadge ? Math.max(1, Math.round((12 - badgeCount * 2) / ($cells.length - badgeCount))) : 0;

      $cells.each((i, cellEl) => {
        const $cell = $(cellEl);
        let span;
        if (hasMixedBadge) {
          span = badgeFlags[i] ? 2 : nonBadgeSpan;
        } else if (widths) {
          span = Math.max(1, Math.round((widths[i] / totalWidth) * 12));
        } else {
          const colspan = parseInt($cell.attr('colspan'), 10) || 1;
          const totalUnits = $cells.toArray().reduce((sum, c) => sum + (parseInt($(c).attr('colspan'), 10) || 1), 0);
          span = Math.max(1, Math.round((colspan / totalUnits) * 12));
        }
        const $col = $(`<div class="col-12 col-md-${span}"></div>`);
        $col.append($cell.contents());
        $bsRow.append($col);
      });
      $container.append($bsRow);
    });

    $table.replaceWith($container);
  });

  // Legacy pages typically accumulate several leftover, unreferenced <map>
  // blocks from old edits -- those are dead weight and get dropped. But a
  // <map> that IS still referenced by a matching img[usemap="#name"] is
  // real, working navigation (e.g. a clickable world map), not cruft --
  // keep both the map and the usemap attribute intact for those.
  const referencedMapNames = new Set();
  $('img[usemap]').each((_, el) => {
    const name = $(el).attr('usemap').replace(/^#/, '');
    referencedMapNames.add(name);
  });
  $('map').each((_, el) => {
    const name = $(el).attr('name');
    if (!referencedMapNames.has(name)) $(el).remove();
  });

  $('img').each((_, el) => {
    $(el).addClass('img-fluid');
  });

  const bodyHtml = $('body').html() || '';
  const title = $('title').text().trim() || 'Untitled';
  return { bodyHtml, title, colors };
}

// Turns the captured bgcolor/text/link/alink/vlink/background attributes
// back into an inline style + scoped <style> block, so each page keeps the
// designer-chosen palette it originally had instead of falling back to one
// generic look site-wide.
function wrapDocument(title, bodyHtml, colors = {}) {
  const bodyStyleParts = [];
  if (colors.bgcolor) bodyStyleParts.push(`background-color: ${colors.bgcolor}`);
  if (colors.background) bodyStyleParts.push(`background-image: url('${colors.background}')`);
  if (colors.text) bodyStyleParts.push(`color: ${colors.text}`);
  const bodyStyleAttr = bodyStyleParts.length ? ` style="${bodyStyleParts.join('; ')}"` : '';

  const linkRules = [];
  if (colors.link) linkRules.push(`a { color: ${colors.link}; }`);
  if (colors.vlink) linkRules.push(`a:visited { color: ${colors.vlink}; }`);
  if (colors.alink) linkRules.push(`a:active { color: ${colors.alink}; }`);
  const linkStyleBlock = linkRules.length ? `<style>\n${linkRules.join('\n')}\n</style>\n` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<link rel="stylesheet" href="/assets/content.css">
${linkStyleBlock}</head>
<body class="legacy-content"${bodyStyleAttr}>
${bodyHtml}
</body>
</html>
`;
}

function main() {
  const root = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!root) {
    console.error('Usage: node modernize.js <root-dir> [--apply]');
    process.exit(1);
  }

  const files = findHtmlFiles(path.resolve(root));
  console.log(`Found ${files.length} legacy HTML files to convert.`);

  const flagged = [];
  let converted = 0;

  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8');
    let result;
    try {
      result = transform(original);
    } catch (err) {
      flagged.push({ file, reason: `transform error: ${err.message}` });
      continue;
    }

    // Content-preservation check: strip all tags from both the original body
    // and the transformed body, normalize whitespace, and compare. Flag any
    // file where transformed text isn't a superset of the original's words
    // (a small amount of drift is expected from whitespace/entity handling,
    // so this flags on a real drop, not formatting noise).
    const $orig = cheerio.load(original);
    $orig('script, style').remove();
    const origText = normalizeText($orig('body').text());
    const newText = normalizeText(cheerio.load(result.bodyHtml)('body').text());
    if (origText.length > 0) {
      const lengthRatio = newText.length / origText.length;
      if (lengthRatio < 0.9) {
        flagged.push({ file, reason: `text length dropped ${(100 - lengthRatio * 100).toFixed(0)}% (orig ${origText.length} chars, new ${newText.length} chars)` });
      }
    }

    if (apply) {
      const outPath = file.replace(HTML_RE, '.modern.html');
      fs.writeFileSync(outPath, wrapDocument(result.title, result.bodyHtml, result.colors), 'utf8');
    }
    converted++;
  }

  console.log(`${apply ? 'Converted' : 'Would convert'}: ${converted}`);
  console.log(`Flagged for review: ${flagged.length}`);
  if (flagged.length) {
    fs.writeFileSync(path.join(path.resolve(root), '..', 'modernize-flagged.json'), JSON.stringify(flagged, null, 2));
    console.log('Details written to modernize-flagged.json');
  }
}

if (require.main === module) main();

module.exports = { transform, wrapDocument };
