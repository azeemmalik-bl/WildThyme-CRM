const { requireUser } = require('./lib/auth');
const { getFile, putFile, ConflictError } = require('./lib/github');
const { collectEditables, applyEdits, mirrorEdits, modernTwinPath } = require('./lib/page-editor');
const { sanitizeHtml } = require('./lib/sanitize-html');

exports.handler = async (event, context) => {
  const user = requireUser(context);
  if (!user) return json(401, { error: 'Not authenticated.' });
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const { file, edits, images } = payload;
  if (!file) return json(400, { error: 'Missing "file".' });
  if ((!edits || edits.length === 0) && (!images || images.length === 0)) {
    return json(400, { error: 'Nothing to save.' });
  }

  // Edits are made against the mobile-optimized twin when one exists (see
  // admin-get-page.js), then mirrored onto the original desktop page.
  const origPath = `content/${file}`;
  const twinPath = modernTwinPath(origPath);
  let current;
  let repoPath = twinPath;
  try {
    current = await getFile(twinPath);
    if (!current) {
      repoPath = origPath;
      current = await getFile(origPath);
    }
  } catch (err) {
    return json(502, { error: `Failed to read current file from GitHub: ${err.message}` });
  }
  if (!current) return json(404, { error: `File not found: ${file}` });
  const hasTwin = repoPath === twinPath;

  const { $, blocks, images: currentImages } = collectEditables(current.content);
  const oldTextByPath = new Map(blocks.map((b) => [b.path, b.text]));
  const oldSrcByPath = new Map(currentImages.map((im) => [im.path, im.src]));
  // Never write client-supplied HTML into a page unsanitized -- this becomes
  // part of a publicly served, committed file.
  const sanitizedEdits = (edits || []).map((e) => ({ path: e.path, newHtml: sanitizeHtml(e.newHtml) }));
  const { unmatchedEdits, unmatchedImages } = applyEdits($, sanitizedEdits, images);
  if (unmatchedEdits.length || unmatchedImages.length) {
    return json(409, {
      error: 'This page changed since you opened it, so your edits could not be safely placed. Please reload the page and try again.',
    });
  }

  const newHtml = $.html();
  const message = `Edit via admin panel: ${file} — ${new Date().toISOString()}`;

  try {
    await putFile(repoPath, Buffer.from(newHtml, 'utf8'), current.sha, message);
  } catch (err) {
    if (err instanceof ConflictError) return json(409, { error: err.message });
    return json(502, { error: `Failed to save to GitHub: ${err.message}` });
  }

  if (!hasTwin) return json(200, { ok: true });

  // Mirror onto the desktop original. The mobile save above has already
  // landed, so a failure here is reported as a warning, not an error.
  const textEdits = sanitizedEdits
    .filter((e) => oldTextByPath.has(e.path))
    .map((e) => ({ oldText: oldTextByPath.get(e.path), newHtml: e.newHtml }));
  const imageEdits = (images || [])
    .filter((im) => oldSrcByPath.has(im.path))
    .map((im) => ({ oldSrc: oldSrcByPath.get(im.path), newSrc: im.newSrc, newAlt: im.newAlt }));
  let desktopNotUpdated = textEdits.length + imageEdits.length;
  try {
    const original = await getFile(origPath);
    if (original) {
      const mirrored = mirrorEdits(original.content, textEdits, imageEdits);
      if (mirrored.changed) {
        await putFile(origPath, Buffer.from(mirrored.html, 'utf8'), original.sha, message);
      }
      desktopNotUpdated = mirrored.unmatched.length;
    }
  } catch (err) {
    console.error('Mirroring edit to desktop page failed:', err);
  }

  return json(200, { ok: true, desktopNotUpdated });
};

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
