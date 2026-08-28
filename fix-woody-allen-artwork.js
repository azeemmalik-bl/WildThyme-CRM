// One-off fix for the hand-rebuilt Woody Allen film pages' "Additional
// Artwork" section: the true original (commit 9a172bce) laid these images
// out as a fixed-height thumbnail strip (each image scaled to the same
// height, natural varying width, wrapping freely as needed) -- the
// hand-rebuilt template instead hardcoded them into fixed 2-3-3-style
// Bootstrap column rows that don't match each page's actual image count,
// leaving large gaps whenever a row wasn't fully populated.
//
// Usage: node fix-woody-allen-artwork.js [--apply]

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const PAGES_DIR = 'content/_Woody_Allen/Pages';
const HEADING_TEXT = 'Additional Artwork';

function main() {
  const apply = process.argv.includes('--apply');
  const files = fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith('.html') && f !== '0.Index.html');

  let touched = 0;
  let skippedAlready = 0;

  for (const file of files) {
    const full = path.join(PAGES_DIR, file);
    const html = fs.readFileSync(full, 'utf8');
    const $ = cheerio.load(html, { decodeEntities: false });

    const $h2 = $('h2').filter((_, el) => $(el).text().trim() === HEADING_TEXT);
    if ($h2.length === 0) continue;

    // Collect every .row sibling between this heading and the next one
    // (or the end of the page), pulling out their <img> tags in order.
    const $rowsToRemove = [];
    const imgs = [];
    let node = $h2.get(0).next;
    while (node) {
      if (node.type === 'tag' && node.name === 'h2') break;
      if (node.type === 'tag') {
        const $n = $(node);
        if ($n.hasClass('row')) {
          $n.find('img').each((_, img) => imgs.push($(img)));
          $rowsToRemove.push($n);
        } else if ($n.hasClass('artwork-strip')) {
          // Already fixed on a prior run.
          $rowsToRemove.length = 0;
          imgs.length = 0;
          break;
        }
      }
      node = node.next;
    }
    if (imgs.length === 0) {
      skippedAlready++;
      continue;
    }

    const $strip = $(
      '<div class="artwork-strip d-flex flex-wrap justify-content-center gap-2 mb-2"></div>'
    );
    for (const $img of imgs) {
      $img.removeClass('img-fluid');
      $img.removeAttr('width');
      $img.removeAttr('height');
      $img.attr('style', 'height: 220px; max-width: 100%; width: auto; object-fit: contain;');
      $strip.append($img);
    }

    $rowsToRemove[0].before($strip);
    for (const $row of $rowsToRemove) $row.remove();

    touched++;
    if (apply) fs.writeFileSync(full, $.html(), 'utf8');
  }

  console.log(`${apply ? 'Fixed' : 'Would fix'}: ${touched} of ${files.length} files (${skippedAlready} already fixed/no images)`);
}

main();
