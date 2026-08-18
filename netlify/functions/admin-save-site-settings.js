const { requireUser } = require('./lib/auth');
const { getFile, putFile, ConflictError } = require('./lib/github');

const CSS_PATH = 'assets/content.css';
const FONT_FAMILY_RE = /(body\.legacy-content\s*\{[^}]*?font-family:\s*)([^;]+)(;)/;
// Font-family lists only ever need letters, digits, spaces, commas, hyphens,
// quotes and periods (e.g. "Segoe UI", 'Times New Roman'). Anything else is
// rejected rather than written into a CSS file straight from client input.
const SAFE_FONT_FAMILY_RE = /^[a-zA-Z0-9\s,'".-]+$/;

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

  const fontFamily = (payload.fontFamily || '').trim();
  if (!fontFamily) return json(400, { error: 'Missing fontFamily.' });
  if (!SAFE_FONT_FAMILY_RE.test(fontFamily)) {
    return json(400, { error: "Font family can only contain letters, digits, spaces, commas, hyphens, periods, and quotes." });
  }

  let file;
  try {
    file = await getFile(CSS_PATH);
  } catch (err) {
    return json(502, { error: `Failed to read content.css from GitHub: ${err.message}` });
  }
  if (!file) return json(404, { error: 'content.css not found.' });

  if (!FONT_FAMILY_RE.test(file.content)) {
    return json(500, { error: 'Could not find the body font-family rule in content.css.' });
  }
  const newCss = file.content.replace(FONT_FAMILY_RE, `$1${fontFamily}$3`);

  try {
    await putFile(CSS_PATH, Buffer.from(newCss, 'utf8'), file.sha, `Set sitewide font via admin panel: ${fontFamily}`);
  } catch (err) {
    if (err instanceof ConflictError) return json(409, { error: err.message });
    return json(502, { error: `Failed to save to GitHub: ${err.message}` });
  }

  return json(200, { ok: true });
};

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
