// One-off fix for the hand-rebuilt Woody Allen film pages' credits/cast
// rows and section headings, correcting three gaps from the true original
// (content/_Woody_Allen/Pages/*.html at commit 9a172bce):
// - Rows used a `border-bottom` divider line the original never had.
// - Rows never had the "-" separator between label and value at all.
// - Section headings ("Cast", "Plot", "Music", etc.) were plain left-
//   aligned white <h2>, not the original's red (#FF0000), centered style.
//
// Usage: node fix-woody-allen-rows-headings.js [--apply]

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const PAGES_DIR = 'content/_Woody_Allen/Pages';

function main() {
  const apply = process.argv.includes('--apply');
  const files = fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith('.html') && f !== '0.Index.html');

  let touchedFiles = 0;
  let rowsFixed = 0;
  let headingsFixed = 0;

  for (const file of files) {
    const full = path.join(PAGES_DIR, file);
    const html = fs.readFileSync(full, 'utf8');
    const $ = cheerio.load(html, { decodeEntities: false });
    let changed = false;

    $('.row.border-bottom').each((_, rowEl) => {
      const $row = $(rowEl);
      const $cols = $row.children('div');
      if ($cols.length !== 2) return; // only the label/value shape
      const $label = $cols.eq(0);
      const $value = $cols.eq(1);
      if ($row.find('.dash-sep').length > 0) return; // already fixed

      $row.removeClass('border-bottom').addClass('align-items-center');
      $label.removeClass('col-5').addClass('col-5');
      $value.removeClass('col-7').addClass('col-6');
      $label.after('<div class="col-1 text-center dash-sep">-</div>');

      changed = true;
      rowsFixed++;
    });

    $('h2').each((_, el) => {
      const $h = $(el);
      if ($h.hasClass('text-center') && $h.attr('style')) return; // already fixed
      $h.addClass('text-center');
      const existing = $h.attr('style');
      $h.attr('style', existing ? `${existing}; color: #FF0000` : 'color: #FF0000');
      changed = true;
      headingsFixed++;
    });

    if (changed) {
      touchedFiles++;
      if (apply) fs.writeFileSync(full, $.html(), 'utf8');
    }
  }

  console.log(`${apply ? 'Fixed' : 'Would fix'}: ${touchedFiles} of ${files.length} files (${rowsFixed} rows, ${headingsFixed} headings)`);
}

main();
