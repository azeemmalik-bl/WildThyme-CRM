const { requireUser } = require('./lib/auth');
const { getFile, putFile, ConflictError } = require('./lib/github');
const { collectEditables, applyEdits } = require('./lib/page-editor');
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

  const repoPath = `content/${file}`;
  let current;
  try {
    current = await getFile(repoPath);
  } catch (err) {
    return json(502, { error: `Failed to read current file from GitHub: ${err.message}` });
  }
  if (!current) return json(404, { error: `File not found: ${file}` });

  const { $ } = collectEditables(current.content);
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

  return json(200, { ok: true });
};

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
