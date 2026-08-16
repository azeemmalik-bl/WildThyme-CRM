(function () {
  const appEl = document.querySelector('.app');
  const brandEls = document.querySelectorAll('.brand');
  const breadcrumbEl = document.getElementById('breadcrumb');
  const gridEl = document.getElementById('grid');
  const viewer = document.getElementById('viewer');
  const searchInput = document.getElementById('search');
  const searchResultsEl = document.getElementById('search-results');

  let navTree = [];
  let searchIndex = [];
  const fileMeta = new Map(); // file -> { title, ancestry: [folder names] }

  // Current view state: either browsing a folder (path = ancestry of folder
  // names from root) or viewing a file (openFile = relative file path).
  let path = [];
  let openFile = null;

  function indexFileMeta(nodes, ancestry) {
    nodes.forEach((node) => {
      if (node.type === 'dir') {
        indexFileMeta(node.children, [...ancestry, node.name]);
      } else {
        fileMeta.set(node.file, { title: node.name, ancestry });
      }
    });
  }

  function resolveDir(targetPath) {
    let level = navTree;
    let node = null;
    for (const name of targetPath) {
      node = level.find((n) => n.type === 'dir' && n.name === name);
      if (!node) return { children: [], node: null };
      level = node.children;
    }
    return { children: level, node };
  }

  // A folder whose only visible item is a single page (everything else
  // hidden as reachable from that page, or just one file to begin with) is
  // pointless to drill into — jump straight to opening that page instead.
  function enterFolder(targetPath) {
    path = targetPath;
    openFile = null;
    const { node } = resolveDir(path);
    if (node && node.directFile) openFile = node.directFile;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  const LEAF_ICON = `
    <svg class="box-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 54C10 28 26 10 54 10C54 38 36 54 10 54Z" fill="currentColor"/>
      <path d="M10 54C22 42 34 30 50 14" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" opacity="0.55"/>
    </svg>
  `;

  function renderBreadcrumb() {
    const segments = ['<span class="crumb" data-index="-1">Home</span>'];
    path.forEach((name, i) => {
      segments.push('<span class="sep">/</span>');
      const isLast = i === path.length - 1 && !openFile;
      segments.push(
        isLast
          ? `<span class="current">${escapeHtml(name)}</span>`
          : `<span class="crumb" data-index="${i}">${escapeHtml(name)}</span>`
      );
    });
    if (openFile) {
      const meta = fileMeta.get(openFile);
      segments.push('<span class="sep">/</span>');
      segments.push(`<span class="current">${escapeHtml(meta ? meta.title : openFile)}</span>`);
    }
    breadcrumbEl.innerHTML = segments.join('');

    breadcrumbEl.querySelectorAll('.crumb').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index, 10);
        enterFolder(idx === -1 ? [] : path.slice(0, idx + 1));
        render(true);
      });
    });
  }

  function renderGrid() {
    const nodes = resolveDir(path).children.filter((node) => !node.hidden);
    gridEl.innerHTML = '';

    if (nodes.length === 0) {
      gridEl.innerHTML = '<div class="empty-message">Nothing here.</div>';
      return;
    }

    nodes.forEach((node) => {
      const box = document.createElement('div');
      if (node.type === 'dir') {
        box.className = 'box folder';
        box.innerHTML = `
          ${LEAF_ICON}
          <div class="box-name">${escapeHtml(node.name)}</div>
        `;
        box.addEventListener('click', () => {
          enterFolder([...path, node.name]);
          render(true);
        });
      } else {
        box.className = 'box file';
        box.innerHTML = `
          ${LEAF_ICON}
          <div class="box-name">${escapeHtml(node.name)}</div>
        `;
        box.addEventListener('click', () => {
          openFile = node.file;
          render(true);
        });
      }
      gridEl.appendChild(box);
    });
  }

  function render(pushState) {
    renderBreadcrumb();
    appEl.classList.toggle('browsing', path.length > 0 || !!openFile);

    if (openFile) {
      gridEl.classList.add('hidden');
      viewer.classList.remove('hidden');
      viewer.src = 'content/' + openFile;
    } else {
      viewer.classList.add('hidden');
      viewer.src = 'about:blank';
      gridEl.classList.remove('hidden');
      renderGrid();
    }

    if (pushState) {
      const url = new URL(window.location.href);
      if (openFile) {
        url.searchParams.set('p', openFile);
      } else {
        url.searchParams.delete('p');
        if (path.length) url.searchParams.set('dir', path.join('/'));
        else url.searchParams.delete('dir');
      }
      history.pushState({ path: [...path], openFile }, '', url);
    }

    searchResultsEl.classList.add('hidden');
    searchInput.value = '';
  }

  function syncFromIframe() {
    try {
      const pathname = viewer.contentWindow.location.pathname;
      const match = [...fileMeta.keys()].find((file) => pathname.endsWith('/content/' + file) || pathname.endsWith(file));
      if (match && match !== openFile) {
        openFile = match;
        path = fileMeta.get(match).ancestry;
        renderBreadcrumb();
        const url = new URL(window.location.href);
        url.searchParams.set('p', match);
        history.replaceState({ path: [...path], openFile }, '', url);
      }
    } catch (err) {
      // cross-origin or not-yet-loaded iframe; ignore
    }
  }

  viewer.addEventListener('load', syncFromIframe);

  brandEls.forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      enterFolder([]);
      render(true);
    });
  });

  window.addEventListener('popstate', (e) => {
    const state = e.state;
    path = (state && state.path) || [];
    openFile = (state && state.openFile) || null;
    render(false);
  });

  function runSearch(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      searchResultsEl.classList.add('hidden');
      searchResultsEl.innerHTML = '';
      return;
    }
    const matches = searchIndex
      .map((doc) => {
        const titleHit = doc.title.toLowerCase().includes(q);
        const textIndex = doc.text.toLowerCase().indexOf(q);
        if (!titleHit && textIndex === -1) return null;
        let snippet = '';
        if (textIndex !== -1) {
          const start = Math.max(0, textIndex - 40);
          snippet = (start > 0 ? '…' : '') + doc.text.slice(start, textIndex + 80) + '…';
        }
        return { doc, titleHit, snippet };
      })
      .filter(Boolean)
      .sort((a, b) => (b.titleHit ? 1 : 0) - (a.titleHit ? 1 : 0))
      .slice(0, 25);

    if (matches.length === 0) {
      searchResultsEl.innerHTML = '<div class="search-result-item">No matches found.</div>';
      searchResultsEl.classList.remove('hidden');
      return;
    }

    searchResultsEl.innerHTML = '';
    matches.forEach(({ doc, snippet }) => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `
        <div class="search-result-title">${escapeHtml(doc.title)}</div>
        <div class="search-result-path">${escapeHtml(doc.breadcrumb)}</div>
        ${snippet ? `<div class="search-result-snippet">${escapeHtml(snippet)}</div>` : ''}
      `;
      item.addEventListener('click', () => {
        path = doc.ancestry || [];
        openFile = doc.file;
        render(true);
      });
      searchResultsEl.appendChild(item);
    });
    searchResultsEl.classList.remove('hidden');
  }

  searchInput.addEventListener('input', (e) => runSearch(e.target.value));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) searchResultsEl.classList.add('hidden');
  });

  Promise.all([
    fetch('assets/nav.json').then((r) => r.json()),
    fetch('assets/search-index.json').then((r) => r.json()),
  ])
    .then(([nav, index]) => {
      navTree = nav;
      searchIndex = index;
      indexFileMeta(navTree, []);

      const url = new URL(window.location.href);
      const initialFile = url.searchParams.get('p');
      const initialDir = url.searchParams.get('dir');
      if (initialFile && fileMeta.has(initialFile)) {
        openFile = initialFile;
        path = fileMeta.get(initialFile).ancestry;
      } else if (initialDir) {
        enterFolder(initialDir.split('/').filter(Boolean));
      }
      render(false);
    })
    .catch((err) => {
      gridEl.innerHTML = '<p style="padding:20px;font-size:13px;color:#b91c1c;">Failed to load document index. Run <code>node build.js</code> after adding files to content/.</p>';
      console.error(err);
    });
})();
