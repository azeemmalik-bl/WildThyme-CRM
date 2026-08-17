const { requireUser } = require('./lib/auth');
const { getFile } = require('./lib/github');
const { collectEditables } = require('./lib/page-editor');

exports.handler = async (event, context) => {
  const user = requireUser(context);
  if (!user) return json(401, { error: 'Not authenticated.' });

  const file = event.queryStringParameters && event.queryStringParameters.file;
  if (!file) return json(400, { error: 'Missing "file" query parameter.' });

  const repoPath = `content/${file}`;
  let result;
  try {
    result = await getFile(repoPath);
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
