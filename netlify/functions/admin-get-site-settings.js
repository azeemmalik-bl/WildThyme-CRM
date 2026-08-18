const { requireUser } = require('./lib/auth');
const { getFile } = require('./lib/github');

const CSS_PATH = 'assets/content.css';
const FONT_FAMILY_RE = /(body\.legacy-content\s*\{[^}]*?font-family:\s*)([^;]+)(;)/;

exports.handler = async (event, context) => {
  const user = requireUser(context);
  if (!user) return json(401, { error: 'Not authenticated.' });

  let file;
  try {
    file = await getFile(CSS_PATH);
  } catch (err) {
    return json(502, { error: `Failed to read content.css from GitHub: ${err.message}` });
  }
  if (!file) return json(404, { error: 'content.css not found.' });

  const m = file.content.match(FONT_FAMILY_RE);
  if (!m) return json(500, { error: 'Could not find the body font-family rule in content.css.' });

  return json(200, { fontFamily: m[2].trim() });
};

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
