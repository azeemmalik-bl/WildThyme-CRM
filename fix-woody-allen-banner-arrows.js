// One-off fix for the hand-rebuilt Woody Allen film pages: the true
// original (content/_Woody_Allen/Pages/*.html at commit 9a172bce) had the
// "WOODY ALLEN MOVIES" skyline banner (Images/Cover.jpg, linking back to
// the index) above the nav row, and round yellow arrow buttons
// (Images/Left-Arrow.jpg / Right-Arrow.jpg) instead of plain text links --
// none of that survived into the hand-rebuilt template used for these
// pages (0.Index.html itself already has the banner; only the per-film
// pages are missing it).
//
// Usage: node fix-woody-allen-banner-arrows.js [--apply]

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const PAGES_DIR = 'content/_Woody_Allen/Pages';

function main() {
  const apply = process.argv.includes('--apply');
  const files = fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith('.html') && f !== '0.Index.html');

  let touched = 0;

  for (const file of files) {
    const full = path.join(PAGES_DIR, file);
    const html = fs.readFileSync(full, 'utf8');
    const $ = cheerio.load(html, { decodeEntities: false });

    const $nav = $('p.d-flex.justify-content-between').first();
    if ($nav.length === 0) continue;

    let changed = false;

    // Insert the banner right before the nav row, same markup/position as
    // the index page already uses, unless it's somehow already there.
    if ($('img[src*="Cover.jpg"]').length === 0) {
      $nav.before(
        '<div class="text-center mb-4">\n' +
          '<a href="0.Index.html"><img src="../Images/Cover.jpg" class="img-fluid" alt="Woody Allen Films" width="690" height="200"></a>\n' +
          '</div>\n\n'
      );
      changed = true;
    }

    // Swap each nav link's text for the matching round arrow button image,
    // keeping each page's own href (already correct) untouched. Position
    // (first vs second) determines direction, not the current text, since
    // wording varies ("← All films" vs "← Previous", "Next →" vs "All
    // films" on the last page in the series). Pages in the middle of the
    // series have a THIRD link between the two ("All films", back to the
    // index) that the true original never had -- leave that one as plain
    // text and only swap the outer two (first/last), regardless of count.
    const $links = $nav.find('a');
    if ($links.length >= 2) {
      const $left = $links.first();
      const $right = $links.last();
      if ($left.find('img').length === 0) {
        $left.html('<img src="../Images/Left-Arrow.jpg" width="50" height="51" alt="Previous">');
        changed = true;
      }
      if ($right.find('img').length === 0) {
        $right.html('<img src="../Images/Right-Arrow.jpg" width="50" height="51" alt="Next">');
        changed = true;
      }
    }

    // The true original colors the film title gold (#FFCC33), distinct
    // from the general white body-text fix applied to headings sitewide.
    const $title = $('h1.text-center').first();
    if ($title.length && !$title.attr('style')) {
      $title.attr('style', 'color: #FFCC33');
      changed = true;
    }

    if (changed) {
      touched++;
      if (apply) fs.writeFileSync(full, $.html(), 'utf8');
    }
  }

  console.log(`${apply ? 'Fixed' : 'Would fix'}: ${touched} of ${files.length} Woody Allen film pages`);
}

main();
