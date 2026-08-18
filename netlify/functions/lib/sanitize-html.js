// Whitelist-based sanitizer for rich text coming back from the admin
// panel's Quill editor. This content gets written directly into a public
// page and committed to GitHub, so it must never pass through unsanitized
// -- a client-supplied <script> or event handler would otherwise become a
// real XSS vector on the live site.
//
// Allows only inline formatting tags and, on <span>, only a `style`
// attribute containing color/font-family/font-size declarations. Anything
// else (other tags, other attributes, event handlers, <script>) is either
// unwrapped (kept as plain text/children) or dropped entirely.
const cheerio = require('cheerio');

const ALLOWED_TAGS = new Set(['p', 'span', 'strong', 'b', 'em', 'i', 'u', 'br']);

const COLOR_RE = /^#[0-9a-fA-F]{3,6}$|^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/;
const FONT_FAMILY_RE = /^[a-zA-Z0-9\s,'".-]+$/;
const FONT_SIZE_RE = /^\d+(\.\d+)?(px|em|pt)$/;

function sanitizeStyle(styleAttr) {
  if (!styleAttr) return '';
  const kept = [];
  styleAttr.split(';').forEach((decl) => {
    const idx = decl.indexOf(':');
    if (idx === -1) return;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (prop === 'color' && COLOR_RE.test(value)) kept.push(`color: ${value}`);
    else if (prop === 'font-family' && FONT_FAMILY_RE.test(value)) kept.push(`font-family: ${value}`);
    else if (prop === 'font-size' && FONT_SIZE_RE.test(value)) kept.push(`font-size: ${value}`);
  });
  return kept.join('; ');
}

function sanitizeHtml(html) {
  const $ = cheerio.load(html || '', { decodeEntities: false });

  $('body *').each((_, el) => {
    if (el.type !== 'tag') return;
    const $el = $(el);
    const tag = el.name;

    if (!ALLOWED_TAGS.has(tag)) {
      $el.replaceWith($el.contents());
      return;
    }

    const keptStyle = tag === 'span' ? sanitizeStyle($el.attr('style')) : '';
    Object.keys(el.attribs || {}).forEach((attr) => $el.removeAttr(attr));
    if (keptStyle) $el.attr('style', keptStyle);
    else if (tag === 'span') {
      // A span with no surviving style carries no formatting -- unwrap it
      // rather than leaving an empty, meaningless wrapper behind.
      $el.replaceWith($el.contents());
    }
  });

  return $('body').html() || '';
}

module.exports = { sanitizeHtml };
