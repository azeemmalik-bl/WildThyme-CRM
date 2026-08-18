// Schema-agnostic editable-block/image detection, shared by admin-get-page.js
// and admin-save-page.js so both sides compute identical node paths.
//
// Each block's inner HTML is returned (not stripped to plain text), so the
// admin panel's rich-text editor can show and round-trip existing inline
// formatting (bold, colored spans, etc.) instead of flattening it. HTML
// coming back on save is expected to have already been through
// lib/sanitize-html.js — this module doesn't sanitize itself. Untouched
// blocks keep their original inner HTML byte-for-byte. Blocks containing a
// link (<a>) are excluded from editing entirely — replacing their contents
// would silently delete the link (nav prev/next/index links, or inline
// cross-references to other pages).
//
// KNOWN LIMITATION: v1 only supports editing EXISTING text/images, never
// adding or removing elements — node paths are positional and would shift if
// the document's shape changed between load and save.
const cheerio = require('cheerio');

const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote', 'dt', 'dd']);

// A deterministic path from <body> to `el`, expressed as dot-separated indices
// among each ancestor's *element* children (text nodes ignored). Recomputed
// fresh on every read/save — nothing is ever injected into the saved file.
function nodePath(el) {
  const idxs = [];
  let cur = el;
  while (cur && cur.type === 'tag' && cur.name !== 'body') {
    const parent = cur.parent;
    if (!parent) break;
    const siblings = (parent.children || []).filter((c) => c.type === 'tag');
    idxs.unshift(siblings.indexOf(cur));
    cur = parent;
  }
  return idxs.join('.');
}

// Parses html and returns { $, blocks, images }. Filters out empty/whitespace
// junk nodes (common in legacy GoLive-era markup: spacer cells, empty divs).
function collectEditables(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const blocks = [];
  const images = [];
  let currentHeading = null;

  $('body *').each((_, el) => {
    if (el.type !== 'tag') return;
    const tag = el.name;

    if (tag === 'img') {
      images.push({ path: nodePath(el), src: $(el).attr('src') || '', alt: $(el).attr('alt') || '' });
      return;
    }

    if (!TEXT_TAGS.has(tag)) return;
    // Editing replaces the block's entire inner HTML, which would silently
    // delete any link inside it (nav prev/next/index links, or inline
    // cross-references like "see <a>Match Point</a>"). Skip any block
    // containing a link rather than risk destroying it.
    if ($(el).find('a').length > 0) return;
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return;

    const isHeading = /^h[1-6]$/.test(tag);
    blocks.push({ path: nodePath(el), tag, section: isHeading ? null : currentHeading, text, html: $(el).html() || '' });
    if (isHeading) currentHeading = text;
  });

  return { $, blocks, images };
}

// Applies edits/images (by path) onto an already-loaded `$`. Returns any
// paths that couldn't be matched (meaning the document shifted since the
// paths were computed — caller should treat this as a conflict, not silently
// drop the edit).
// `edits` items are { path, newHtml } — newHtml is expected to have already
// been through lib/sanitize-html.js by the time it reaches here.
function applyEdits($, edits, images) {
  const editMap = new Map((edits || []).map((e) => [e.path, e.newHtml]));
  const imageMap = new Map((images || []).map((im) => [im.path, im]));

  $('body *').each((_, el) => {
    if (el.type !== 'tag') return;
    const p = nodePath(el);

    if (el.name === 'img' && imageMap.has(p)) {
      const im = imageMap.get(p);
      if (im.newSrc) $(el).attr('src', im.newSrc);
      if (im.newAlt !== undefined) $(el).attr('alt', im.newAlt);
      imageMap.delete(p);
      return;
    }

    if (TEXT_TAGS.has(el.name) && editMap.has(p)) {
      $(el).html(editMap.get(p));
      editMap.delete(p);
    }
  });

  return { unmatchedEdits: [...editMap.keys()], unmatchedImages: [...imageMap.keys()] };
}

module.exports = { collectEditables, applyEdits, nodePath, TEXT_TAGS };
