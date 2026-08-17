// Thin wrapper over the GitHub Contents API. Requires GITHUB_TOKEN, GITHUB_OWNER,
// GITHUB_REPO env vars (set as Netlify environment variables); GITHUB_BRANCH
// defaults to "main".
const API_BASE = 'https://api.github.com';

class ConflictError extends Error {}

function config() {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    throw new Error('Missing GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO environment variables.');
  }
  return { token: GITHUB_TOKEN, owner: GITHUB_OWNER, repo: GITHUB_REPO, branch: GITHUB_BRANCH || 'main' };
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function encodePath(repoPath) {
  return repoPath.split('/').map(encodeURIComponent).join('/');
}

// Returns { content: <utf8 string>, sha } for a text file, or null if it doesn't exist.
async function getFile(repoPath) {
  const { token, owner, repo, branch } = config();
  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${encodePath(repoPath)}?ref=${branch}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getFile ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
}

// contentBuffer: a Buffer (works for text or binary). sha: pass the current file's
// sha to update it, or omit/undefined to create a new file.
async function putFile(repoPath, contentBuffer, sha, message) {
  const { token, owner, repo, branch } = config();
  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${encodePath(repoPath)}`;
  const body = { message, content: contentBuffer.toString('base64'), branch };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    throw new ConflictError('This file changed on GitHub since it was loaded — please reload and try again.');
  }
  if (!res.ok) throw new Error(`GitHub putFile ${res.status}: ${await res.text()}`);
  return res.json();
}

module.exports = { getFile, putFile, ConflictError };
