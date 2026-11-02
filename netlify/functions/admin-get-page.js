const { requireUser } = require('./lib/auth');
const { getFile } = require('./lib/github');
const { collectEditables, modernTwinPath } = require('./lib/page-editor');

exports.handler = async (event, context) => {
  const user = requireUser(context);
  if (!user) return json(401, { error: 'Not authenticated.' });

  const file = event.queryStringParameters && event.queryStringParameters.file;
  if (!file) return json(400, { error: 'Missing "file" query parameter.' });

  // Edit the mobile-optimized twin when there is one: its clean markup is
  // what the block editor understands. Saving mirrors edits to the original.
  const repoPath = `content/${file}`;
  let result;
  try {
    result = (await getFile(modernTwinPath(repoPath))) || (await getFile(repoPath));
  } catch (err) {
    return json(502, { error: `Failed to read file from GitHub: ${err.message}` });
  }
  if (!result) return json(404, { error: `File not found: ${file}` });

  const { blocks, images } = collectEditables(result.content);
  return json(200, { file, blocks, images });
};

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
