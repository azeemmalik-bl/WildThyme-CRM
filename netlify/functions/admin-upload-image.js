const { requireUser } = require('./lib/auth');
const { getFile, putFile } = require('./lib/github');

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

  const { targetFolder, filename, contentBase64 } = payload;
  if (!targetFolder || !filename || !contentBase64) {
    return json(400, { error: 'Missing targetFolder, filename, or contentBase64.' });
  }
  if (!/^[\w.\- ]+$/.test(filename)) return json(400, { error: 'Invalid filename.' });
  if (/\.\./.test(targetFolder)) return json(400, { error: 'Invalid targetFolder.' });

  const relPath = `${targetFolder}/${filename}`.replace(/\/{2,}/g, '/');
  const repoPath = `content/${relPath}`;

  let existing = null;
  try {
    existing = await getFile(repoPath);
  } catch (err) {
    return json(502, { error: `Failed to check existing file: ${err.message}` });
  }

  try {
    await putFile(
      repoPath,
      Buffer.from(contentBase64, 'base64'),
      existing ? existing.sha : undefined,
      `Upload image via admin panel: ${relPath}`
    );
  } catch (err) {
    return json(502, { error: `Failed to upload image: ${err.message}` });
  }

  return json(200, { ok: true, path: relPath });
};

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
