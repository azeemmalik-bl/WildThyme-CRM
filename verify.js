// Compares each original legacy page against its hand-rebuilt "<name>.modern.html"
// counterpart and flags any where visible text content dropped significantly.
// This is the safety net standing in for manual page-by-page review at a scale
// where manual review isn't feasible.
//
// Usage: node verify.js <dir-or-file> [<dir-or-file> ...]

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

function normalizeText(str) {
  return str.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function extractText(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(html);
  $('script, style').remove();
  return normalizeText($('body').text());
}

function findModernPairs(root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      findModernPairs(full, out);
    } else if (entry.name.endsWith('.modern.html')) {
      const originalName = entry.name.replace(/\.modern\.html$/, '.html');
      const originalPath = path.join(root, originalName);
      if (fs.existsSync(originalPath)) out.push({ originalPath, modernPath: full });
      else {
        const htmName = entry.name.replace(/\.modern\.html$/, '.htm');
        const htmPath = path.join(root, htmName);
        if (fs.existsSync(htmPath)) out.push({ originalPath: htmPath, modernPath: full });
      }
    }
  }
  return out;
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error('Usage: node verify.js <dir-or-file> [...]');
    process.exit(1);
  }

  let pairs = [];
  for (const t of targets) {
    const stat = fs.statSync(t);
    if (stat.isDirectory()) pairs = pairs.concat(findModernPairs(t));
    else if (t.endsWith('.modern.html')) {
      const originalPath = t.replace(/\.modern\.html$/, '.html');
      if (fs.existsSync(originalPath)) pairs.push({ originalPath, modernPath: t });
    }
  }

  console.log(`Checking ${pairs.length} page pairs...`);
  const flagged = [];

  for (const { originalPath, modernPath } of pairs) {
    let origText, newText;
    try {
      origText = extractText(originalPath);
      newText = extractText(modernPath);
    } catch (err) {
      flagged.push({ modernPath, reason: `read/parse error: ${err.message}` });
      continue;
    }
    if (origText.length === 0) continue;
    const ratio = newText.length / origText.length;
    if (ratio < 0.85) {
      flagged.push({
        modernPath,
        reason: `text length dropped ${(100 - ratio * 100).toFixed(0)}% (orig ${origText.length} chars, new ${newText.length} chars)`,
      });
    }

    // Link-preservation check: every internal .html link in the original
    // should still appear somewhere in the modern version (as href).
    const $orig = cheerio.load(fs.readFileSync(originalPath, 'utf8'));
    const $new = cheerio.load(fs.readFileSync(modernPath, 'utf8'));
    const origLinks = new Set();
    $orig('a[href]').each((_, el) => {
      const href = el.attribs.href;
      if (href && /\.html?($|#|\?)/i.test(href) && !/^https?:/i.test(href)) origLinks.add(href.split('#')[0].split('?')[0]);
    });
    const newLinks = new Set();
    $new('a[href]').each((_, el) => {
      const href = el.attribs.href;
      if (href) newLinks.add(href.split('#')[0].split('?')[0]);
    });
    const missingLinks = [...origLinks].filter((l) => !newLinks.has(l));
    if (missingLinks.length > 0) {
      flagged.push({ modernPath, reason: `${missingLinks.length} internal link(s) missing: ${missingLinks.slice(0, 5).join(', ')}` });
    }
  }

  console.log(`Flagged: ${flagged.length} / ${pairs.length}`);
  if (flagged.length) {
    fs.writeFileSync('verify-flagged.json', JSON.stringify(flagged, null, 2));
    console.log('Details written to verify-flagged.json');
  }
}

main();
