// One-off fix for the hand-rebuilt Woody Allen / Twin Peaks page template:
// - The "← All films" / "Next →" nav links were plain <a> tags, which
//   Bootstrap underlines by default -- the client asked for that removed.
// - The "(1966)"-style year used Bootstrap's .text-muted, a fixed gray that
//   reads far too faint against these pages' own (often dark) backgrounds.
//   Swapping it for opacity keeps it dimmed relative to whatever the
//   page's actual text color is, instead of a hardcoded absolute gray.
//
// Usage: node fix-nav-and-muted.js [--apply]

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const DIRS = ['content/_Woody_Allen', 'content/_Twin_Peaks'];
const HTML_RE = /\.html?$/i;

function findHtmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findHtmlFiles(full, out);
    else if (HTML_RE.test(entry.name) && !entry.name.includes('.modern.')) out.push(full);
  }
  return out;
}

function main() {
  const apply = process.argv.includes('--apply');
  let touched = 0;
  let navFixed = 0;
  let mutedFixed = 0;

  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const file of findHtmlFiles(dir)) {
      const html = fs.readFileSync(file, 'utf8');
      const $ = cheerio.load(html, { decodeEntities: false });
      let changed = false;

      $('p.d-flex.justify-content-between > a').each((_, el) => {
        const $a = $(el);
        if (!$a.hasClass('text-decoration-none')) {
          $a.addClass('text-decoration-none');
          changed = true;
          navFixed++;
        }
      });

      $('.text-muted').each((_, el) => {
        const $el = $(el);
        $el.removeClass('text-muted');
        const existing = $el.attr('style');
        $el.attr('style', existing ? `${existing}; opacity: 0.7` : 'opacity: 0.7');
        changed = true;
        mutedFixed++;
      });

      if (changed) {
        touched++;
        if (apply) fs.writeFileSync(file, $.html(), 'utf8');
      }
    }
  }

  console.log(`${apply ? 'Fixed' : 'Would fix'}: ${touched} files (${navFixed} nav links, ${mutedFixed} muted elements)`);
}

main();
