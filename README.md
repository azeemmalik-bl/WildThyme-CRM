# Document Library Site

Wraps your client's existing HTML/image hierarchy in a single site: a persistent
sidebar (auto-built from the folder structure), full-text search, and a viewer
pane that loads the original HTML pages unmodified. The existing documents and
their internal links are left completely as-is — nothing in `content/` is
rewritten.

## 1. Add the client's files

Copy the entire existing HTML + image repository into the `content/` folder,
preserving its current folder hierarchy exactly as it is today. For example:

```
content/
  Products/
    catalog.html
    images/photo1.jpg
  Manuals/
    setup/
      intro.html
      step1.html
```

Do not flatten or rename anything — the folder structure becomes the sidebar
navigation automatically, and relative links between the HTML files keep
working since the files stay in their original relative positions.

## 2. Generate the navigation + search index

Requires Node.js (no other dependencies).

```
node build.js
```

This scans `content/` and writes `assets/nav.json` and
`assets/search-index.json`. Re-run it any time files are added, removed, or
renamed in `content/`.

## 3. Preview locally

Open `index.html` via a local static server (the sidebar/search fetch JSON
files, which most browsers block over `file://`). For example, from this
folder:

```
npx serve .
```

or, with Python:

```
python -m http.server 8080
```

Then visit the printed URL.

## 4. Deploy to Netlify

This folder is ready to deploy as-is:

- Build command: `node build.js`
- Publish directory: `.`

Either connect the folder/repo in the Netlify UI, or deploy directly with the
Netlify CLI:

```
netlify deploy --prod
```

If the client's file repository is very large (many large images), consider
whether it should live in the git repo at all — Netlify also supports
deploying large asset sets via its CLI without committing everything to git,
or hosting the images on a separate asset host and linking to them from the
HTML.

## 5. Client-editable admin panel

There's a login-gated editor at `/admin/` that lets one invited person edit
existing text and replace existing images on any page in `content/`, without
touching code. It works by detecting editable text blocks (headings,
paragraphs, list items) and images directly from each page's HTML at edit
time — no per-page-type schema needed — then committing the change to GitHub,
which triggers Netlify to rebuild and redeploy automatically.

**Scope of v1:** editing existing text/images only — no adding, removing, or
reordering elements. Editing a paragraph flattens any inline formatting
inside it (bold/italic) to plain text; paragraphs containing a link are
skipped entirely so navigation/cross-reference links can never be
accidentally deleted.

### One-time setup

1. **Git + GitHub**: this folder needs to be a git repo pushed to a GitHub
   repo, with the Netlify site connected to that repo for git-based
   deploys (Site settings → Build & deploy → Link repository). Deploys then
   happen automatically on every push — no more `netlify deploy --prod`.

2. **A GitHub token for the admin panel to commit with**: create a
   fine-grained Personal Access Token scoped to just this repo, with
   **Contents: Read and write** permission. Add these as Netlify environment
   variables (Site settings → Environment variables):
   - `GITHUB_TOKEN` — the token
   - `GITHUB_OWNER` — the GitHub username/org that owns the repo
   - `GITHUB_REPO` — the repo name
   - `GITHUB_BRANCH` — optional, defaults to `main`

3. **Netlify Identity**: enable it on the site (Site settings → Identity →
   Enable Identity), set registration to **Invite only**, then invite the
   editor's email address (Identity tab → Invite users). They'll get an
   email to set a password and can then log in at `/admin/`.

### How it's built

- `netlify/functions/admin-get-page.js` — reads a page from GitHub, returns
  its detected editable blocks/images.
- `netlify/functions/admin-save-page.js` — re-reads the current version from
  GitHub (to avoid clobbering a concurrent edit), applies the submitted
  changes, and commits the result.
- `netlify/functions/admin-upload-image.js` — commits a replacement image
  file in place (same filename, so the page's `<img src>` never needs to
  change).
- `netlify/functions/lib/page-editor.js` — the shared detection/patch logic
  (uses `cheerio`, already a project dependency). Every editable node is
  addressed by a deterministic position-in-document path, recomputed fresh
  on every read and save — nothing is ever injected into the saved HTML
  itself, so pages you haven't edited stay byte-for-byte untouched.
- `admin/` — the editor UI itself (plain HTML/CSS/JS, no build step), gated
  by the Netlify Identity widget. It reuses the site's own
  `assets/search-index.json` for the page picker, so there's no separate
  index to maintain.

## How it works

- `build.js` walks `content/`, builds a JSON tree of the folder hierarchy, and
  extracts each page's `<title>` and text content into a search index.
- `index.html` / `assets/app.js` render each folder level as a grid of boxes:
  folder boxes drill into their contents, document boxes open the page in a
  full-width viewer. A breadcrumb bar tracks the current location and lets you
  jump back up any level. Live search matches every document's title and body
  text and jumps straight to a result.
- Clicking a link inside a loaded document (i.e. navigating within the
  client's existing hierarchy) automatically updates the breadcrumb to match,
  since the viewer is a same-origin iframe.
