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
