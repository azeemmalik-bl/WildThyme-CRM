(function () {
  'use strict';

  var state = {
    searchIndex: [],
    navTree: [],
    currentFile: null,
    blocks: [],   // [{path, tag, section, text}]
    images: [],   // [{path, src, alt, resolvedDir, resolvedFilename}]
  };

  var els = {
    loginBtn: document.getElementById('login-btn'),
    logoutBtn: document.getElementById('logout-btn'),
    userBox: document.getElementById('user-box'),
    userEmail: document.getElementById('user-email'),
    app: document.getElementById('app'),
    loggedOutMsg: document.getElementById('logged-out-msg'),
    pageSearch: document.getElementById('page-search'),
    pageResults: document.getElementById('page-results'),
    editorPlaceholder: document.getElementById('editor-placeholder'),
    editor: document.getElementById('editor'),
    editorTitle: document.getElementById('editor-title'),
    status: document.getElementById('status'),
    blocks: document.getElementById('blocks'),
    images: document.getElementById('images'),
    saveBtn: document.getElementById('save-btn'),
    saveStatus: document.getElementById('save-status'),
    fontSelect: document.getElementById('font-select'),
    fontCustom: document.getElementById('font-custom'),
    fontSaveBtn: document.getElementById('font-save-btn'),
    fontSaveStatus: document.getElementById('font-save-status'),
  };

  // ---- path helpers (mirrors how content pages reference their own images) ----

  function dirname(p) {
    var parts = p.split('/');
    parts.pop();
    return parts.join('/');
  }

  function basename(p) {
    return p.split('/').pop();
  }

  function resolveRelative(baseDir, relPath) {
    var stack = baseDir ? baseDir.split('/').filter(Boolean) : [];
    var parts = relPath.split('/').filter(Boolean);
    parts.forEach(function (part) {
      if (part === '.') return;
      if (part === '..') stack.pop();
      else stack.push(part);
    });
    return stack.join('/');
  }

  // ---- auth ----

  function currentJwt() {
    var user = window.netlifyIdentity.currentUser();
    if (!user) return Promise.resolve(null);
    return user.jwt();
  }

  function authedFetch(url, options) {
    options = options || {};
    return currentJwt().then(function (jwt) {
      var headers = Object.assign({}, options.headers || {});
      if (jwt) headers.Authorization = 'Bearer ' + jwt;
      return fetch(url, Object.assign({}, options, { headers: headers }));
    });
  }

  function showLoggedIn(user) {
    els.loginBtn.hidden = true;
    els.userBox.hidden = false;
    els.userEmail.textContent = user.email;
    els.app.hidden = false;
    els.loggedOutMsg.hidden = true;
    if (!state.searchIndex.length) loadPickerData();
    loadSiteSettings();
  }

  function showLoggedOut() {
    els.loginBtn.hidden = false;
    els.userBox.hidden = true;
    els.app.hidden = true;
    els.loggedOutMsg.hidden = false;
  }

  window.netlifyIdentity.on('init', function (user) {
    if (user) showLoggedIn(user);
    else showLoggedOut();
  });
  window.netlifyIdentity.on('login', function (user) {
    showLoggedIn(user);
    window.netlifyIdentity.close();
  });
  window.netlifyIdentity.on('logout', showLoggedOut);

  els.loginBtn.addEventListener('click', function () {
    window.netlifyIdentity.open('login');
  });
  els.logoutBtn.addEventListener('click', function () {
    window.netlifyIdentity.logout();
  });

  window.netlifyIdentity.init();

  // ---- page picker: a folder tree (from the site's existing nav.json, same
  // structure the public site browses) with a search box for quick filtering
  // (from the site's existing search-index.json). No new indexing needed.

  function loadPickerData() {
    Promise.all([
      fetch('/assets/nav.json').then(function (res) { return res.json(); }),
      fetch('/assets/search-index.json').then(function (res) { return res.json(); }),
    ])
      .then(function (results) {
        state.navTree = results[0];
        state.searchIndex = results[1];
        renderPageResults('');
      })
      .catch(function () {
        els.pageResults.textContent = 'Failed to load page list.';
      });
  }

  function renderPageResults(query) {
    var q = query.trim().toLowerCase();
    els.pageResults.innerHTML = '';

    // Empty box: browse the same folder tree the public site uses, so
    // clicking a folder reveals its own pages instead of everything at once.
    if (!q) {
      state.navTree.forEach(function (node) {
        els.pageResults.appendChild(renderTreeNode(node));
      });
      return;
    }
    if (q.length < 2) return;

    var matches = state.searchIndex
      .filter(function (doc) {
        return doc.title.toLowerCase().indexOf(q) !== -1 || doc.breadcrumb.toLowerCase().indexOf(q) !== -1;
      })
      .slice(0, 60);

    if (matches.length === 0) {
      var none = document.createElement('li');
      none.className = 'page-results-hint';
      none.textContent = 'No pages match "' + query.trim() + '".';
      els.pageResults.appendChild(none);
      return;
    }

    matches.forEach(function (doc) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'page-result-btn';
      btn.innerHTML = '<strong>' + escapeHtml(doc.title) + '</strong><br><small>' + escapeHtml(doc.breadcrumb) + '</small>';
      btn.addEventListener('click', function () { openPage(doc.file, doc.title); });
      li.appendChild(btn);
      els.pageResults.appendChild(li);
    });
  }

  // Builds one <li> for a nav.json node. Folders render collapsed with a
  // toggle button; their children are only built the first time they're
  // expanded, so opening the picker never has to render all ~21,000 pages'
  // worth of DOM up front.
  function renderTreeNode(node) {
    var li = document.createElement('li');
    li.className = 'tree-node';

    if (node.type === 'dir') {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tree-dir-btn';
      var setLabel = function (expanded) {
        btn.textContent = (expanded ? '▾ ' : '▸ ') + node.name + ' (' + node.count + ')';
      };
      setLabel(false);

      var childUl = document.createElement('ul');
      childUl.className = 'tree-children';
      childUl.hidden = true;
      var built = false;

      btn.addEventListener('click', function () {
        if (!built) {
          node.children.forEach(function (child) {
            childUl.appendChild(renderTreeNode(child));
          });
          built = true;
        }
        childUl.hidden = !childUl.hidden;
        setLabel(!childUl.hidden);
      });

      li.appendChild(btn);
      li.appendChild(childUl);
    } else {
      var fileBtn = document.createElement('button');
      fileBtn.type = 'button';
      fileBtn.className = 'tree-file-btn';
      fileBtn.textContent = node.name;
      fileBtn.addEventListener('click', function () { openPage(node.file, node.name); });
      li.appendChild(fileBtn);
    }

    return li;
  }

  els.pageSearch.addEventListener('input', function () {
    renderPageResults(els.pageSearch.value);
  });

  // ---- editor ----

  function openPage(file, title) {
    setStatus('Loading…');
    authedFetch('/.netlify/functions/admin-get-page?file=' + encodeURIComponent(file))
      .then(handleJsonResponse)
      .then(function (data) {
        state.currentFile = file;
        state.blocks = data.blocks;
        state.images = data.images.map(function (img) {
          var resolved = resolveRelative(dirname(file), img.src);
          return Object.assign({}, img, {
            resolvedDir: dirname(resolved),
            resolvedFilename: basename(resolved),
            previewUrl: '/content/' + resolved,
          });
        });
        renderEditor(title);
        setStatus('');
      })
      .catch(function (err) {
        setStatus('Failed to load page: ' + err.message);
      });
  }

  function renderEditor(title) {
    els.editorPlaceholder.hidden = true;
    els.editor.hidden = false;
    els.editorTitle.textContent = title;
    els.blocks.innerHTML = '';
    els.images.innerHTML = '';

    state.blocks.forEach(function (block, i) {
      var wrap = document.createElement('div');
      wrap.className = 'block-field';

      var label = document.createElement('label');
      label.className = 'block-label';
      label.textContent = block.tag.toUpperCase() + (block.section ? ' — under "' + block.section + '"' : '');
      wrap.appendChild(label);

      var textarea = document.createElement('textarea');
      textarea.value = block.text;
      textarea.dataset.index = String(i);
      textarea.rows = Math.min(6, Math.max(2, Math.ceil(block.text.length / 60)));
      wrap.appendChild(textarea);

      els.blocks.appendChild(wrap);
    });

    state.images.forEach(function (img, i) {
      var wrap = document.createElement('div');
      wrap.className = 'image-field';

      var thumb = document.createElement('img');
      thumb.src = img.previewUrl;
      thumb.className = 'image-thumb';
      thumb.alt = img.alt;
      wrap.appendChild(thumb);

      var controls = document.createElement('div');
      controls.className = 'image-controls';

      var altLabel = document.createElement('label');
      altLabel.textContent = 'Alt text';
      var altInput = document.createElement('input');
      altInput.type = 'text';
      altInput.value = img.alt;
      altInput.dataset.index = String(i);
      altInput.className = 'image-alt-input';
      altLabel.appendChild(altInput);
      controls.appendChild(altLabel);

      var fileLabel = document.createElement('label');
      fileLabel.textContent = 'Replace image';
      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.dataset.index = String(i);
      fileInput.className = 'image-file-input';
      fileLabel.appendChild(fileInput);
      controls.appendChild(fileLabel);

      wrap.appendChild(controls);
      els.images.appendChild(wrap);
    });
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = reader.result; // "data:<mime>;base64,<data>"
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function collectTextEdits() {
    var edits = [];
    els.blocks.querySelectorAll('textarea').forEach(function (ta) {
      var i = Number(ta.dataset.index);
      var block = state.blocks[i];
      if (ta.value !== block.text) edits.push({ path: block.path, newText: ta.value });
    });
    return edits;
  }

  function collectAltEdits() {
    var edits = [];
    els.images.querySelectorAll('.image-alt-input').forEach(function (input) {
      var i = Number(input.dataset.index);
      var img = state.images[i];
      if (input.value !== img.alt) edits.push({ path: img.path, newAlt: input.value });
    });
    return edits;
  }

  function collectImageUploads() {
    var uploads = [];
    els.images.querySelectorAll('.image-file-input').forEach(function (input) {
      if (input.files && input.files[0]) {
        var i = Number(input.dataset.index);
        uploads.push({ img: state.images[i], file: input.files[0] });
      }
    });
    return uploads;
  }

  function handleJsonResponse(res) {
    return res.json().then(function (data) {
      if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
      return data;
    });
  }

  els.saveBtn.addEventListener('click', function () {
    if (!state.currentFile) return;
    els.saveBtn.disabled = true;
    setSaveStatus('Saving…');

    var uploads = collectImageUploads();
    var textEdits = collectTextEdits();
    var altEdits = collectAltEdits();

    Promise.all(
      uploads.map(function (u) {
        return fileToBase64(u.file).then(function (b64) {
          return authedFetch('/.netlify/functions/admin-upload-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetFolder: u.img.resolvedDir, // resolvedDir is already relative to content/
              filename: u.img.resolvedFilename,
              contentBase64: b64,
            }),
          }).then(handleJsonResponse);
        });
      })
    )
      .then(function () {
        var edits = textEdits;
        var images = altEdits;
        if (edits.length === 0 && images.length === 0) return { ok: true };
        return authedFetch('/.netlify/functions/admin-save-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: state.currentFile, edits: edits, images: images }),
        }).then(handleJsonResponse);
      })
      .then(function () {
        setSaveStatus('Saved — publishing now, usually live within about a minute.');
        // Reload the page's current state so re-saving reflects what was just written.
        return openPage(state.currentFile, els.editorTitle.textContent);
      })
      .catch(function (err) {
        setSaveStatus('');
        setStatus('Save failed: ' + err.message);
      })
      .then(function () {
        els.saveBtn.disabled = false;
      });
  });

  // ---- site settings (sitewide default font) ----

  function loadSiteSettings() {
    authedFetch('/.netlify/functions/admin-get-site-settings')
      .then(handleJsonResponse)
      .then(function (data) {
        applyFontToControls(data.fontFamily);
      })
      .catch(function (err) {
        setFontSaveStatus('');
        setStatus('Failed to load site settings: ' + err.message);
      });
  }

  function applyFontToControls(fontFamily) {
    var matched = false;
    Array.prototype.forEach.call(els.fontSelect.options, function (opt) {
      if (opt.value === fontFamily) matched = true;
    });
    if (matched) {
      els.fontSelect.value = fontFamily;
      els.fontCustom.hidden = true;
    } else {
      els.fontSelect.value = '__custom__';
      els.fontCustom.hidden = false;
      els.fontCustom.value = fontFamily;
    }
  }

  els.fontSelect.addEventListener('change', function () {
    els.fontCustom.hidden = els.fontSelect.value !== '__custom__';
    if (!els.fontCustom.hidden) els.fontCustom.focus();
  });

  els.fontSaveBtn.addEventListener('click', function () {
    var fontFamily = els.fontSelect.value === '__custom__' ? els.fontCustom.value.trim() : els.fontSelect.value;
    if (!fontFamily) {
      setFontSaveStatus('Enter a font family first.');
      return;
    }
    els.fontSaveBtn.disabled = true;
    setFontSaveStatus('Saving…');
    authedFetch('/.netlify/functions/admin-save-site-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fontFamily: fontFamily }),
    })
      .then(handleJsonResponse)
      .then(function () {
        setFontSaveStatus('Saved — publishing now, usually live within about a minute.');
      })
      .catch(function (err) {
        setFontSaveStatus('');
        setStatus('Save failed: ' + err.message);
      })
      .then(function () {
        els.fontSaveBtn.disabled = false;
      });
  });

  function setFontSaveStatus(msg) {
    els.fontSaveStatus.textContent = msg;
  }

  function setStatus(msg) {
    els.status.textContent = msg;
  }

  function setSaveStatus(msg) {
    els.saveStatus.textContent = msg;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
