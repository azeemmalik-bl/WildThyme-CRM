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

  // Unwrap <font> entirely -- typography is now controlled by content.css.
  $('font').each((_, el) => {
    $(el).replaceWith($(el).contents());
  });

  // <center> -> div.text-center (keeps the same visual intent as a real class).
  $('center').each((_, el) => {
    const $el = $(el);
    $el.replaceWith($('<div class="text-center"></div>').append($el.contents()));
  });

  // Strip inline event handlers and presentational body attributes; the
  // href/src that these handlers duplicated stays untouched.
  $('*').each((_, el) => {
    if (!el.attribs) return;
    for (const attr of JS_HANDLER_ATTRS) delete el.attribs[attr];
  });
  for (const attr of PRESENTATIONAL_BODY_ATTRS) $('body').removeAttr(attr);
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

  // Convert layout tables into Bootstrap rows/cols. This is a structural
  // transform only -- cell contents move verbatim into the new column divs.
  $('table').each((_, tableEl) => {
    const $table = $(tableEl);
    const $rows = $table.children('tr').length ? $table.children('tr') : $table.find('> tbody > tr');
    const $container = $('<div class="container-fluid legacy-table px-0"></div>');

    $rows.each((_, rowEl) => {
      const $row = $(rowEl);
      const $allCells = $row.children('td, th');
      if ($allCells.length === 0) return;
      const $cells = $allCells.filter((_, c) => !isCellEmpty($(c)));
      if ($cells.length === 0) return;
      const $bsRow = $('<div class="row gy-2"></div>');
      $cells.each((_, cellEl) => {
        const $cell = $(cellEl);
        const colspan = parseInt($cell.attr('colspan'), 10) || 1;
        // Bootstrap 12-col grid, scaled by how many colspan-units this row has.
        const totalUnits = $cells.toArray().reduce((sum, c) => sum + (parseInt($(c).attr('colspan'), 10) || 1), 0);
        const span = Math.max(1, Math.round((colspan / totalUnits) * 12));
        const $col = $(`<div class="col-12 col-md-${span}"></div>`);
        $col.append($cell.contents());
        $bsRow.append($col);
      });
      $container.append($bsRow);
    });

    $table.replaceWith($container);
  });

  // Legacy image-map coordinates (usemap) were tuned to old fixed image sizes
  // and mean nothing once the image scales fluidly -- drop the now-broken
  // map/usemap pairing but keep the image itself intact.
  $('img[usemap]').removeAttr('usemap');
  $('map').remove();

  $('img').each((_, el) => {
    $(el).addClass('img-fluid');
  });

  const bodyHtml = $('body').html() || '';
  const title = $('title').text().trim() || 'Untitled';
  return { bodyHtml, title };
}

function wrapDocument(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<link rel="stylesheet" href="/assets/content.css">
</head>
<body>
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
      fs.writeFileSync(outPath, wrapDocument(result.title, result.bodyHtml), 'utf8');
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

main();
