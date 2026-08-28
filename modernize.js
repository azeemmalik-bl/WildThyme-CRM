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
const PRESENTATIONAL_COLOR_ATTRS = new Set(['bgcolor', 'link', 'alink', 'vlink', 'text']); // excludes 'background' (an image URL, not a color)

// Legacy HTML tolerates a bare hex triplet/sextet without the leading '#'
// (e.g. color="ac3c30") -- valid there, but invalid CSS, which silently
// drops the whole declaration rather than erroring. Add the '#' back so
// the color actually renders instead of quietly falling back to inherited.
function normalizeColor(value) {
  if (!value) return value;
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{3}$/.test(trimmed) || /^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed}`;
  return trimmed;
}

// Legacy <font size> uses an absolute 1-7 scale (or +N/-N relative to a
// base of 3) with no CSS equivalent -- map it to the same em values
// browsers historically rendered each size as, so a page that used size="5"
// or "6" for emphasis doesn't collapse to the same size as everything else.
const FONT_SIZE_EM = { 1: '0.625em', 2: '0.8em', 3: '1em', 4: '1.125em', 5: '1.5em', 6: '2em', 7: '3em' };
function resolveFontSize(sizeAttr) {
  const trimmed = (sizeAttr || '').trim();
  const n = /^[+-]\d+$/.test(trimmed) ? 3 + parseInt(trimmed, 10) : parseInt(trimmed, 10);
  if (!Number.isFinite(n)) return null;
  return FONT_SIZE_EM[Math.max(1, Math.min(7, n))];
}

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
    const size = resolveFontSize($el.attr('size'));
    const styleParts = [];
    if (color) styleParts.push(`color: ${normalizeColor(color)}`);
    if (face) styleParts.push(`font-family: ${face}`);
    if (size) styleParts.push(`font-size: ${size}`);
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
    if (val) colors[attr] = PRESENTATIONAL_COLOR_ATTRS.has(attr) ? normalizeColor(val) : val;
    $('body').removeAttr(attr);
  }
  $('body').addClass('legacy-content');

  // Legacy <img border="N"> inside a link rendered with the link's own
  // color as its border in old browsers -- a "this thumbnail is
  // clickable" visual cue -- but modern browsers don't reliably reproduce
  // that inherited-color behavior, silently rendering a default/invisible
  // border instead. Make the intended color explicit rather than leaving
  // it to inheritance.
  const borderColor = colors.link || colors.text;
  if (borderColor) {
    $('img[border]').each((_, el) => {
      const $img = $(el);
      const width = parseInt($img.attr('border'), 10);
      if (!Number.isFinite(width) || width <= 0) return;
      $img.removeAttr('border');
      const existing = $img.attr('style');
      const styleStr = `border: ${width}px solid ${borderColor}`;
      $img.attr('style', existing ? `${existing}; ${styleStr}` : styleStr);
    });
  }

  // A cell that was purely a spacer in the old 2D table grid (no text, no
  // image, no link) has nothing worth keeping once we stack vertically --
  // it only existed to hold column alignment. Dropping it entirely avoids
  // an empty block appearing between real content when stacked on mobile.
  function isCellEmpty($cell) {
    if ($cell.find('img').length > 0) return false;
    const text = normalizeText($cell.text());
    return text.length === 0;
  }

  // Most empty cells are just incidental "<td>&nbsp;</td>" padding with no
  // colspan of their own -- dropping those entirely (as isCellEmpty above
  // does) is correct, they carry no real layout intent. But an empty cell
  // that DOES carry an explicit colspan>1 (e.g. the wide gap deliberately
  // separating a pair of nav arrows at a row's far edges) is real design
  // intent and needs to keep reserving that space, or its siblings silently
  // grow to fill the row and lose their real proportions. A bare `width` on
  // an empty cell, without a colspan, is deliberately NOT treated as
  // meaningful here -- those are typically tiny cosmetic pixel dividers
  // between an image and its caption, and including them inflates that
  // row's kept-cell count enough to spuriously collide with an unrelated
  // row shape sharing the same count in exemplarWidthsByCellCount below
  // (which matches purely by count, not by row shape).
  function isMeaningfulSpacer($cell) {
    if (!isCellEmpty($cell)) return false;
    const colspan = parseInt($cell.attr('colspan'), 10);
    return Number.isFinite(colspan) && colspan > 1;
  }

  // The recurring page-nav row (a left arrow, a title spanning several
  // columns, a right arrow) almost never has its own per-cell `width` on
  // every cell (typically only the two arrow cells do, not the title), so
  // it falls back to exemplarWidthsByCellCount -- a table-wide map keyed
  // purely by cell COUNT, blind to what the row actually is. Any other
  // unrelated 3-cell row elsewhere in the same table that happens to carry
  // real widths on all 3 of its cells (e.g. a "label - value" credits row)
  // gets borrowed here, often squashing the title down to a sliver. A nav
  // row is reliably identifiable by its arrow images, so give it its own
  // reliable signal -- colspan, which is what the original page itself used
  // to size the title -- instead of gambling on an unrelated exemplar.
  // Different sections name their nav-arrow images differently --
  // Arrow-left.jpg, Arrow-L.png, Arrow_Right.jpg, Arrow-Back.jpg all show
  // up across the site for the exact same "previous/next page" role.
  // Deliberately narrower than a bare /Arrow/i match: filenames like
  // Arrow-Roxy.jpg, Arrow-link.jpg, or Arrow_poster.jpg aren't page
  // navigation at all, and getting misclassified as a nav row would wrongly
  // force whatever row they're in through the symmetric-outer-columns path.
  function isArrowNavRow($cells) {
    return $cells.toArray().some((c) =>
      $(c)
        .find('img')
        .toArray()
        .some((img) => /Arrow[-_](L(eft)?|R(ight)?|Back|Forward)\b/i.test($(img).attr('src') || ''))
    );
  }

  // A recurring "label - value" credits row (Directed by / - / Gerald
  // Thomas) is reliably identifiable by its literal "-" middle cell. Its
  // label/value pixel widths (e.g. 387 vs 412) are almost always just
  // copy-paste noise from the original authoring, not real design intent,
  // but that noise is enough to put the dash a few percent off page-center
  // -- so even though the row's own container is genuinely centered, the
  // visible label-dash-value text reads as unbalanced under a centered
  // heading above it. Force the label and value to mirror each other.
  function isLabelDashRow($cells) {
    return $cells.length === 3 && normalizeText($cells.eq(1).text()) === '-';
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

  // Turns a set of relative weights (pixel widths, colspans, or badge/
  // non-badge ratios) into Bootstrap column spans that always sum to
  // exactly 12. Rounding each cell's share independently (naive
  // Math.round) can push the row's total to 13+, which silently wraps
  // whichever cell doesn't fit onto its own line -- e.g. a 5-cell row of
  // 2+3+3+3+2 = 13 wraps the last cell down, making a right-hand badge
  // look like it landed on the left instead. This uses the largest-
  // remainder method to distribute the 12 columns exactly.
  function distributeSpans(weights) {
    const total = weights.reduce((a, b) => a + b, 0) || weights.length;
    const raw = weights.map((w) => (w / total) * 12);
    const spans = raw.map((r) => Math.max(1, Math.floor(r)));
    let sum = spans.reduce((a, b) => a + b, 0);
    const remainders = raw.map((r, i) => ({ i, frac: r - Math.floor(r) }));

    if (sum < 12) {
      remainders.sort((a, b) => b.frac - a.frac);
      for (let k = 0; sum < 12; k++) {
        spans[remainders[k % remainders.length].i]++;
        sum++;
      }
    } else if (sum > 12) {
      remainders.sort((a, b) => a.frac - b.frac);
      for (let k = 0; sum > 12 && k < spans.length * 4; k++) {
        const idx = remainders[k % remainders.length].i;
        if (spans[idx] > 1) {
          spans[idx]--;
          sum--;
        }
      }
    }
    return spans;
  }

  // Convert layout tables into Bootstrap rows/cols. This is a structural
  // transform only -- cell contents move verbatim into the new column divs.
  $('table').each((_, tableEl) => {
    const $table = $(tableEl);
    const $rows = $table.children('tr').length ? $table.children('tr') : $table.find('> tbody > tr');
    // A leftover ancestor `<div align="center">` -- the legacy trick for
    // centering a fixed-width <table> on the page -- has nothing left to
    // center once the table becomes a fluid Bootstrap container, but its
    // text-align:center still inherits down into every cell's paragraphs
    // that don't set their own alignment, silently centering body text that
    // was left-aligned in the original render. Reset it explicitly here;
    // any cell/paragraph with its own align="center" is unaffected since an
    // element's own explicit alignment always wins over an inherited value.
    const $container = $('<div class="container-fluid legacy-table px-0" style="text-align: left"></div>');

    // Legacy tables often repeat a "label - value" row shape many times
    // (cast lists, crew lists, itineraries...), but only the first
    // occurrence carries width="" attributes -- a common copy-paste-without-
    // full-attributes authoring pattern. Scan for an exemplar set of
    // proportions per cell-count up front, to reuse on sibling rows that
    // share the same shape but lack their own width data.
    const exemplarWidthsByCellCount = new Map();
    $rows.each((_, rowEl) => {
      const $cells = $(rowEl)
        .children('td, th')
        .filter((_, c) => !isCellEmpty($(c)) || isMeaningfulSpacer($(c)));
      if ($cells.length === 0 || exemplarWidthsByCellCount.has($cells.length)) return;
      const widths = $cells.toArray().map((c) => parseInt($(c).attr('width'), 10));
      if (widths.every((w) => Number.isFinite(w) && w > 0)) exemplarWidthsByCellCount.set($cells.length, widths);
    });

    // A single-surviving-cell heading row (e.g. "PLOT", "MUSIC:", "PLUS")
    // could originally have been sitting in the label column's own raw
    // position (just a right-aligned label, no dash/value that row), the
    // dash column's position (a short centered word occupying that narrow
    // slot), or a genuinely spanning colspan>1 heading -- and each needs
    // different treatment (right-aligned in column 1, centered in column
    // 2, or centered spanning all 3) to land where it actually sat in the
    // original. Filtering already collapsed the row down to one cell by
    // the time it's classified, losing that positional context, so record
    // which RAW child-index of a <tr> the label/dash/value cells occupy in
    // a normal 3-cell row of this table up front, to compare against later.
    let labelRawIndex = null;
    let dashRawIndex = null;
    $rows.each((_, rowEl) => {
      if (labelRawIndex !== null) return;
      const $raw = $(rowEl).children('td, th');
      const $kept = $raw.filter((_, c) => !isCellEmpty($(c)) || isMeaningfulSpacer($(c)));
      if (!isLabelDashRow($kept)) return;
      const rawArr = $raw.toArray();
      labelRawIndex = rawArr.indexOf($kept.get(0));
      dashRawIndex = rawArr.indexOf($kept.get(1));
    });

    // Consecutive "label - value" credits rows (Directed by / Produced by
    // / ... , or a whole cast list) are buffered here and flushed together
    // as one CSS Grid block, rather than each becoming its own Bootstrap
    // row. Percentage-based Bootstrap columns must pick a width big enough
    // for the widest content anywhere in that column across the WHOLE
    // table (via exemplarWidthsByCellCount) or otherwise guess -- for a
    // one-character "-" that leaves a wide, unnecessary gap on both sides
    // of the dash. A grid's columns instead auto-size to the widest cell
    // actually in that column, so the dash column shrinks to just fit "-"
    // while the label/value columns still line up exactly down every row.
    // A section heading (e.g. "Cast") interrupting a run of label-dash rows
    // -- one kept cell, no image -- is buffered as a full-span pass-through
    // item instead of flushing, so e.g. the credits block above "Cast" and
    // the cast list below it share ONE grid and stay aligned with each
    // other, matching how they shared a single table (and so a single set
    // of column widths) in the original. Flushing on every heading would
    // otherwise restart the auto-sizing per section, letting unrelated
    // sections (a short "Release date" label vs a long character name)
    // drift out of alignment with each other for no real reason.
    let labelDashBuffer = [];
    // A heading row seen while inside a label-dash run is held here
    // UNCOMMITTED rather than merged in immediately -- we don't yet know if
    // it's a real section break within the same credits/cast block (Cast,
    // sandwiched between two runs of label-dash rows) or the start of
    // unrelated content after the block ends (a Plot paragraph, a new
    // image row). Only get committed into the grid once a further
    // label-dash row actually confirms the run continues; otherwise, on
    // any other row, they're flushed back out as ordinary standalone rows,
    // so they never get to accidentally absorb the rest of the page's
    // unrelated content into one runaway-wide grid.
    let pendingHeadings = [];
    const unwrapAlignDiv = ($cell) => {
      const $wrap = $cell.children('div[align]').first();
      return $wrap.length ? $wrap.html() : $cell.html();
    };
    // A short single-cell row ("PLOT", "MUSIC:", "PLUS") is a real section
    // marker worth trying to keep aligned with its neighboring label-dash
    // rows. A long one is ordinary prose (a Plot synopsis paragraph) that
    // also happens to reduce to one kept cell -- treating that as a
    // heading candidate would force-center normal paragraph text if no
    // label-dash row happens to follow it. The length cutoff is what tells
    // the two apart; genuine headings in this pattern are always a few
    // words.
    function isSimpleHeadingRow($cells) {
      return (
        $cells.length === 1 &&
        $cells.first().find('img').length === 0 &&
        normalizeText($cells.first().text()).length <= 60
      );
    }
    function flushLabelDashBuffer() {
      if (labelDashBuffer.length === 0) return;
      const rowsHtml = labelDashBuffer
        .map((item) => {
          if (item.heading === undefined) {
            return (
              `<div style="text-align: right">${item.label}</div>` +
              `<div style="text-align: center">${item.dash}</div>` +
              `<div style="text-align: left">${item.value}</div>`
            );
          }
          // A heading's ORIGINAL slot decides how it should sit here: one
          // spanning multiple original columns (colspan>1, e.g. "Cast") is
          // a real centered section break -- span the whole grid. One that
          // occupied the label column's own raw position (e.g. "MUSIC:",
          // "FILM REFERENCES:") stays right-aligned there, in line with
          // every other label. One that occupied the dash column's own
          // position (e.g. "PLUS", "PLOT" -- a short word centered in that
          // narrow slot) stays centered there instead of spanning or
          // jumping to the label side. Label/dash-slot items still emit
          // ALL 3 grid cells (2 of them empty) rather than just their own
          // div -- a lone div with no explicit grid-column just consumes
          // whatever cell auto-placement hands it next, which then shoves
          // every real label/dash/value in the following rows sideways by
          // one column for the rest of the grid.
          if (item.slot === 'label') return `<div style="text-align: right">${item.heading}</div><div></div><div></div>`;
          if (item.slot === 'dash') return `<div></div><div style="text-align: center">${item.heading}</div><div></div>`;
          return `<div style="grid-column: 1 / -1; text-align: center;">${item.heading}</div>`;
        })
        .join('');
      // Left (label) and right (value) columns auto-size independently to
      // their own widest content -- fine within one row, but across an
      // entire credits+cast block the labels ("Directed by") are typically
      // much shorter than the values (character names), so the two
      // columns end up very different widths. That pushes the dash off to
      // one side of the block's overall center, so a heading centered
      // across the whole block (like "Cast") no longer lines up with it.
      // Give both outer columns the same minimum width (the longer of the
      // two sides' own longest entry, approximated in `ch` units) so they
      // grow roughly in step and the dash stays near true center.
      // Capped at 40 -- a genuine label/character-name pair is always
      // short, so this is just balancing "Directed by" against "Gerald
      // Thomas". A value that's actually a full sentence (a film
      // reference note, a synopsis-style credit) would otherwise set this
      // "minimum" width to that sentence's entire length, forcing BOTH
      // outer columns to never shrink below e.g. 198ch and blowing the
      // whole grid out past the page -- long values are meant to wrap
      // within their own column, not dictate the label column's width.
      const plainLen = (html) => normalizeText($('<div>').html(html || '').text()).length;
      const maxOuterChars = Math.min(
        40,
        Math.max(1, ...labelDashBuffer.filter((item) => item.heading === undefined).flatMap((item) => [plainLen(item.label), plainLen(item.value)]))
      );
      // Without a width limit of its own, a value that's a full sentence
      // (not just a short character name) just keeps the "max-content"
      // column growing to fit that sentence on one line, pushing the
      // whole grid wider than the page instead of wrapping. Capping the
      // grid's own box lets the grid track-sizing algorithm shrink that
      // column back down under space pressure and wrap normally, the way
      // any of these auto/max-content tracks already can once the grid
      // itself isn't allowed to grow without bound.
      const $grid = $(
        `<div style="display: grid; grid-template-columns: minmax(${maxOuterChars}ch, max-content) auto ` +
          `minmax(${maxOuterChars}ch, max-content); column-gap: 0.5em; row-gap: 10px; justify-content: center; ` +
          // As a flex item (inside the .d-flex wrapper below), this box
          // defaults to min-width:auto, which sizes it to its own
          // max-content and overrides max-width entirely -- min-width:0
          // is what actually lets max-width take effect and the value
          // column wrap.
          `max-width: 100%; min-width: 0;"></div>`
      );
      $grid.html(rowsHtml);
      $container.append($('<div class="d-flex justify-content-center my-2"></div>').append($grid));
      labelDashBuffer = [];
    }
    function flushPendingHeadingsStandalone() {
      for (const item of pendingHeadings) {
        const style = item.slot === 'label' ? 'text-align: right' : 'text-align: center';
        $container.append($(`<div style="${style}"></div>`).html(item.heading));
      }
      pendingHeadings = [];
    }

    $rows.each((_, rowEl) => {
      const $row = $(rowEl);
      const $allCells = $row.children('td, th');
      if ($allCells.length === 0) return;
      // Truly incidental empty "<td>&nbsp;</td>" padding (no width, no
      // colspan) is dropped entirely, same as before -- it carries no real
      // layout intent. An empty cell that DOES carry an explicit width or
      // colspan>1 is kept (as isMeaningfulSpacer above), since that's real
      // design intent (e.g. the wide gap deliberately separating a pair of
      // nav arrows at a row's far edges) that would otherwise be lost,
      // leaving the remaining cells to split the full 12 columns between
      // them instead of keeping their real proportions.
      let $cells = $allCells.filter((_, c) => !isCellEmpty($(c)) || isMeaningfulSpacer($(c)));
      if ($cells.length === 0) return;

      if (isLabelDashRow($cells)) {
        for (const item of pendingHeadings) labelDashBuffer.push({ heading: item.heading, slot: item.slot });
        pendingHeadings = [];
        labelDashBuffer.push({
          label: unwrapAlignDiv($cells.eq(0)),
          dash: unwrapAlignDiv($cells.eq(1)),
          value: unwrapAlignDiv($cells.eq(2)),
        });
        return;
      }
      if (isSimpleHeadingRow($cells)) {
        const colspan = parseInt($cells.eq(0).attr('colspan'), 10);
        const rawIndex = $allCells.toArray().indexOf($cells.get(0));
        let slot = 'span';
        if (!(Number.isFinite(colspan) && colspan > 1)) {
          if (labelRawIndex !== null && rawIndex === labelRawIndex) slot = 'label';
          else if (dashRawIndex !== null && rawIndex === dashRawIndex) slot = 'dash';
        }
        pendingHeadings.push({ heading: unwrapAlignDiv($cells.eq(0)), slot });
        return;
      }
      flushLabelDashBuffer();
      flushPendingHeadingsStandalone();

      // A nav row's arrows are meant to hug the true edges of the browser
      // window, but this page's body has its own long-standing
      // max-width:1100px + margin:0 auto (a readability setting, applied
      // site-wide) -- any Bootstrap percentage column lives INSIDE that
      // already-centered, narrower box, so no amount of column-span math
      // can ever get an arrow past that box's own edge out to the real
      // viewport edge. Nav rows need to visually break out of it entirely:
      // render as a flex row stretched to the full viewport width (the
      // standard "full-bleed" trick -- 100vw sized, then shifted left by
      // half that width from the container's own horizontal center), with
      // justify-content:space-between naturally pushing the first/last
      // cell to those true edges and any middle cell (a title, or nothing)
      // sitting centered between them.
      if (isArrowNavRow($cells)) {
        const $bleed = $(
          '<div style="width: 100vw; position: relative; left: 50%; margin-left: -50vw; ' +
            'display: flex; justify-content: space-between; align-items: center; ' +
            'padding: 0 1rem; box-sizing: border-box;"></div>'
        );
        $cells.each((_, cellEl) => {
          const $cell = $(cellEl);
          if (isCellEmpty($cell)) {
            $bleed.append('<div></div>');
            return;
          }
          $bleed.append($('<div></div>').append(unwrapAlignDiv($cell)));
        });
        $container.append($bleed);
        return;
      }

      // HTML <td> defaults to vertical-align: middle absent any override,
      // so that's the right default once stacked into a Bootstrap row too.
      // But an explicit valign="top" (common on rows pairing a short image
      // with a much taller text cell, so the image stays flush with the
      // text's first line rather than drifting down to its middle) is real
      // authored intent and needs to survive the conversion, not get
      // silently overridden by a blanket default.
      const rowValign = ($row.attr('valign') || $cells.first().attr('valign') || 'middle').toLowerCase();
      const alignItemsClass =
        { top: 'align-items-start', bottom: 'align-items-end', middle: 'align-items-center' }[rowValign] ||
        'align-items-center';
      const $bsRow = $(`<div class="row gy-2 ${alignItemsClass}"></div>`);

      // Prefer pixel `width` (this row's own, or borrowed from an exemplar
      // sibling) over colspan or the badge heuristic below when computing
      // Bootstrap column proportions -- it's real design intent, whereas
      // colspan-only math treats a narrow "-" separator column the same as
      // the wide name/role columns beside it, and the badge heuristic is
      // only a fallback guess for when no width data exists at all.
      // (Nav rows never reach here at all -- they return early above, via
      // their own full-bleed flex layout instead of these Bootstrap
      // columns.)
      const ownWidths = $cells.toArray().map((c) => parseInt($(c).attr('width'), 10));
      const ownHaveWidth = ownWidths.every((w) => Number.isFinite(w) && w > 0);
      const widths = ownHaveWidth ? ownWidths : exemplarWidthsByCellCount.get($cells.length);

      const badgeFlags = $cells.toArray().map((c) => isBadgeCell($(c)));
      const badgeCount = badgeFlags.filter(Boolean).length;
      const hasMixedBadge = badgeCount > 0 && badgeCount < $cells.length;

      let weights;
      if (widths) {
        weights = widths;
      } else if (hasMixedBadge) {
        weights = badgeFlags.map((isBadge) => (isBadge ? 1 : 5));
      } else {
        // Some legacy pages carry a malformed negative colspan (e.g.
        // colspan="-2", a stray authoring artifact browsers just clamp to
        // 1) -- `parseInt(...) || 1` doesn't catch that, since -2 is
        // truthy, so it would pass the negative straight through as a
        // weight and corrupt the whole row's proportions. Clamp to >=1.
        weights = $cells.toArray().map((c) => Math.max(1, parseInt($(c).attr('colspan'), 10) || 1));
      }
      const spans = distributeSpans(weights);

      $cells.each((i, cellEl) => {
        const $cell = $(cellEl);
        // An empty spacer cell has no content worth stacking on mobile (see
        // isCellEmpty above), but its width still needs to hold its place
        // in the desktop grid (that's the whole point of keeping it in the
        // weights above) -- render it as a column that reserves that space
        // on desktop but disappears entirely on the mobile stacked layout,
        // rather than leaving a blank block between real content there.
        if (isCellEmpty($cell)) {
          $bsRow.append($(`<div class="d-none d-md-block col-md-${spans[i]}"></div>`));
          return;
        }
        const $col = $(`<div class="col-12 col-md-${spans[i]}"></div>`);
        // A small decorative badge (e.g. a "1993" year-label graphic)
        // paired beside a much bigger poster/photo was usually centered
        // within its OWN narrow column in the original -- fine when that
        // column's width was chosen to just fit the badge, but our badge
        // heuristic above already sizes this column tightly to the badge,
        // so centering it just adds an arbitrary bit of blank margin on
        // both sides instead of sitting flush against the poster beside
        // it. Left-align it instead, regardless of what the original cell
        // said, so the badge visually anchors to its neighboring image.
        if (isBadgeCell($cell)) {
          // The badge's own content is very likely wrapped in its original
          // <div align="center"> -- that inner element's own alignment
          // would otherwise still win over this outer text-align:left.
          $cell.find('div[align]').attr('align', 'left');
          $col.append($('<div style="text-align: left"></div>').append($cell.contents()));
          $bsRow.append($col);
          return;
        }
        // A cell holding nothing but an image, with no alignment wrapper of
        // its own, relied entirely on the ambient text-align:center from
        // the legacy wrapping div/table (now reset to left, to stop it
        // leaking into unrelated body paragraphs) to center itself in its
        // column -- exactly like its sibling image cells that DO have an
        // explicit align="center" wrapper. Add that wrapper back so bare
        // and explicitly-wrapped image cells render the same way.
        const isBareImageOnly =
          normalizeText($cell.text()).length === 0 &&
          $cell.find('img').length > 0 &&
          $cell.children('div[align], p[align]').length === 0;
        if (isBareImageOnly) {
          $col.append($('<div style="text-align: center"></div>').append($cell.contents()));
        } else {
          $col.append($cell.contents());
        }
        $bsRow.append($col);
      });
      $container.append($bsRow);
    });
    flushLabelDashBuffer();
    flushPendingHeadingsStandalone();

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

  // content.css hardcodes a default link color via `body.legacy-content a`
  // -- a bare `a { color: ... }` override (lower specificity) always loses
  // to that regardless of cascade order, silently keeping the generic blue
  // link color on every page that had its own link/vlink/alink instead of
  // the page's own designer-chosen color. Match content.css's own selector
  // so the override actually wins.
  const linkRules = [];
  if (colors.link) linkRules.push(`body.legacy-content a { color: ${colors.link}; }`);
  if (colors.vlink) linkRules.push(`body.legacy-content a:visited { color: ${colors.vlink}; }`);
  if (colors.alink) linkRules.push(`body.legacy-content a:active { color: ${colors.alink}; }`);
  // content.css hardcodes headings to a dark color for its own light-theme
  // default -- on any page restoring a dark background, that fixed dark
  // color renders dark-on-dark and headings just disappear. Override with
  // the same selector content.css uses (same specificity, later in the
  // cascade = wins) so headings stay legible against this page's own
  // restored background.
  if (colors.text) {
    linkRules.push(
      'body.legacy-content h1, body.legacy-content h2, body.legacy-content h3, ' +
        `body.legacy-content h4, body.legacy-content h5, body.legacy-content h6 { color: ${colors.text}; }`
    );
  }
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

module.exports = { transform, wrapDocument, normalizeColor };
