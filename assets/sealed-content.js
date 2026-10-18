/* Public ciphertext reader. Access codes and plaintext are never bundled here. */
(() => {
  'use strict';
  const utf8 = new TextEncoder();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const epochPattern = /^[a-f0-9]{32}$/;
  const idPattern = /^[a-f0-9]{64}$/;
  const storageKey = 'kamome.access.session.v1';
  const hasFields = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));

  function unbase64(value, expectedLength) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 8_000_000) throw Error('Invalid encoding');
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    if (expectedLength !== undefined && bytes.length !== expectedLength) throw Error('Invalid byte length');
    return bytes;
  }

  function base64(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function validateManifest(value) {
    if (!hasFields(value, ['version', 'epoch', 'codes']) || value.version !== 1 || !epochPattern.test(value.epoch) || !Array.isArray(value.codes) || value.codes.length > 512) throw Error('Invalid manifest');
    const ids = new Set();
    for (const code of value.codes) {
      if (!hasFields(code, ['id', 'salt', 'iv', 'wrapped_key', 'rounds']) || !idPattern.test(code.id) || ids.has(code.id) || code.rounds !== 600000) throw Error('Invalid access code entry');
      ids.add(code.id);
      unbase64(code.salt, 16);
      unbase64(code.iv, 12);
      unbase64(code.wrapped_key, 48);
    }
    return value;
  }

  async function unwrapCode(manifest, input, subtle = globalThis.crypto.subtle) {
    validateManifest(manifest);
    const code = String(input).replace(/[\s-]/gu, '').toUpperCase();
    if (!/^[0-9A-F]{32}$/.test(code)) throw Error('Invalid access code');
    const digest = await subtle.digest('SHA-256', utf8.encode('kamome-access-code:v1:' + code));
    const id = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const entry = manifest.codes.find(candidate => candidate.id === id);
    if (!entry) throw Error('Invalid access code');
    const material = await subtle.importKey('raw', utf8.encode(code), 'PBKDF2', false, ['deriveKey']);
    const wrapping = await subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt: unbase64(entry.salt, 16), iterations: entry.rounds}, material, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
    const raw = new Uint8Array(await subtle.decrypt({name: 'AES-GCM', iv: unbase64(entry.iv, 12), additionalData: utf8.encode('kamome-access-wrap:v1:' + manifest.epoch + ':' + id), tagLength: 128}, wrapping, unbase64(entry.wrapped_key, 48)));
    if (raw.length !== 32) throw Error('Invalid master key');
    return raw;
  }

  async function importMaster(raw, subtle = globalThis.crypto.subtle) {
    if (!(raw instanceof Uint8Array) || raw.length !== 32) throw Error('Invalid master key');
    return subtle.importKey('raw', raw, {name: 'AES-GCM'}, false, ['decrypt']);
  }

  async function decryptBlock(encoded, epoch, key, subtle = globalThis.crypto.subtle) {
    const envelope = JSON.parse(decoder.decode(unbase64(encoded)));
    if (!hasFields(envelope, ['v', 'epoch', 'iv', 'ciphertext']) || envelope.v !== 1 || envelope.epoch !== epoch || !epochPattern.test(epoch)) throw Error('Outdated encrypted content');
    const cipher = unbase64(envelope.ciphertext);
    if (cipher.length < 16 || cipher.length > 4 * 1024 * 1024 + 16) throw Error('Invalid content length');
    const plain = await subtle.decrypt({name: 'AES-GCM', iv: unbase64(envelope.iv, 12), additionalData: utf8.encode('kamome-access-content:v1:' + epoch), tagLength: 128}, key, cipher);
    const content = JSON.parse(decoder.decode(plain));
    if (!hasFields(content, ['markdown', 'html']) || typeof content.markdown !== 'string' || typeof content.html !== 'string' || content.html.length > 4 * 1024 * 1024) throw Error('Invalid content');
    return content.html;
  }

  // Available to offline interoperability tests; no browser debug or key API.
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined') module.exports = {unbase64, base64, validateManifest, unwrapCode, importMaster, decryptBlock};
    return;
  }

  const dialog = document.querySelector('#access-dialog');
  const opener = document.querySelector('#access-open');
  const form = document.querySelector('#access-form');
  const input = document.querySelector('#access-code');
  const status = document.querySelector('#access-status');
  const article = document.querySelector('#article-body');
  if (!dialog || !opener || !form || !input || !status) return;

  let manifest = null;
  let manifestPromise = null;
  let master = null;
  let generation = 0;
  let busy = false;
  let lastPointerType = 'keyboard';
  let autoSubmitTimer = null;
  let states = new WeakMap();
  let mathQueue = Promise.resolve();
  const blocks = () => [...(article?.querySelectorAll('.sealed-block[data-sealed]') || [])];
  const setStatus = (text, error = false) => {
    status.textContent = text;
    status.dataset.error = String(error);
    input.setAttribute('aria-invalid', String(error));
  };
  const forgetSession = () => { try { sessionStorage.removeItem(storageKey); } catch {} };
  const sessionData = () => { try { return JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { return null; } };

  async function loadManifest(fresh = false) {
    if (manifestPromise && !fresh) return manifestPromise;
    const task = (async () => {
      const url = new URL(dialog.dataset.manifest, location.href);
      if (url.origin !== location.origin) throw Error('Manifest must be same-origin');
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 10000);
      try {
        const response = await fetch(url, {cache: 'no-store', credentials: 'omit', referrerPolicy: 'same-origin', signal: abort.signal});
        if (!response.ok) throw Error('Manifest unavailable');
        const body = await response.text();
        if (body.length > 300000) throw Error('Manifest too large');
        return validateManifest(JSON.parse(body));
      } finally { clearTimeout(timeout); }
    })();
    manifestPromise = task;
    try {
      const next = await task;
      if (manifest && manifest.epoch !== next.epoch) lock(false);
      manifest = next;
      return next;
    } catch (error) {
      if (manifestPromise === task) manifestPromise = null;
      throw error;
    }
  }

  function updateAccessUi() {
    opener.dataset.verified = String(Boolean(master));
    opener.querySelector('span').textContent = master ? '通过' : '验证访问码';
    for (const node of blocks()) {
      const state = states.get(node);
      if (state) {
        state.button.setAttribute('aria-label', '黑幕内容');
        state.button.disabled = !master;
      }
    }
  }

  function openDialog() {
    if (busy) return;
    updateAccessUi();
    if (master) return;
    if (!crypto?.subtle) setStatus('当前浏览器无法使用加密验证。', true);
    else setStatus('');
    if (!dialog.open) dialog.showModal();
    input.focus();
  }

  function clearReading(node, state) {
    try { window.MathJax?.typesetClear?.([state.reading]); } catch {}
    state.reading.replaceChildren();
    state.reading.hidden = true;
    state.revealed = false;
    node.dataset.revealed = 'false';
    state.button.setAttribute('aria-expanded', 'false');
  }

  function lock(announce = true) {
    generation++;
    master = null;
    forgetSession();
    input.value = '';
    for (const node of blocks()) {
      const state = states.get(node);
      if (!state) continue;
      state.hover = state.focus = state.pinned = false;
      clearReading(node, state);
    }
    updateAccessUi();
    if (announce) setStatus('已退出验证，黑幕已收起。');
  }

  // Parse into an inert template, then copy only supported markup into new nodes.
  // No source attributes, resource elements, inline styles, or event handlers survive.
  function safeFragment(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const allowed = new Set(['P', 'BR', 'HR', 'STRONG', 'EM', 'DEL', 'S', 'B', 'I', 'U', 'CODE', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'SUP', 'SUB', 'A', 'SPAN', 'DIV', 'DL', 'DT', 'DD']);
    const discard = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'IMG', 'PICTURE', 'SOURCE', 'VIDEO', 'AUDIO', 'TRACK', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'TEMPLATE']);
    function copy(source, parent) {
      for (const child of source.childNodes) {
        if (child.nodeType === 3) { parent.append(document.createTextNode(child.textContent)); continue; }
        if (child.nodeType !== 1 || discard.has(child.tagName)) continue;
        if (!allowed.has(child.tagName)) { copy(child, parent); continue; }
        const tag = /^H[1-6]$/.test(child.tagName) ? 'h3' : child.tagName.toLowerCase();
        const clean = document.createElement(tag);
        if (tag === 'a') {
          const href = child.getAttribute('href') || '';
          // External navigation only; no resource fetch is made by rendering a link.
          if (/^(https?:\/\/|mailto:)/i.test(href)) {
            try {
              const target = new URL(href);
              if (!target.username && !target.password) {
                clean.setAttribute('href', target.href);
                clean.setAttribute('target', '_blank');
                clean.setAttribute('rel', 'noopener noreferrer nofollow');
              }
            } catch {}
          }
        }
        if (tag === 'ol' && /^-?\d{1,6}$/.test(child.getAttribute('start') || '')) clean.setAttribute('start', child.getAttribute('start'));
        if ((tag === 'td' || tag === 'th') && /^[1-9]\d?$/.test(child.getAttribute('colspan') || '')) clean.setAttribute('colspan', child.getAttribute('colspan'));
        if ((tag === 'span' || tag === 'div') && child.hasAttribute('data-tex') && (child.classList.contains('math-inline') || child.classList.contains('math-display'))) {
          const tex = child.getAttribute('data-tex');
          clean.textContent = child.classList.contains('math-display') ? '\\[' + tex + '\\]' : '\\(' + tex + '\\)';
        } else copy(child, clean);
        parent.append(clean);
      }
    }
    const fragment = document.createDocumentFragment();
    copy(template.content, fragment);
    return fragment;
  }

  function wantsReading(state) { return Boolean(master && (state.hover || state.focus || state.pinned)); }

  function typesetReading(node, state, token) {
    mathQueue = mathQueue.catch(() => {}).then(async () => {
      const math = window.MathJax;
      if (math?.startup?.promise) await math.startup.promise;
      if (token !== generation || !node.isConnected || !state.revealed || !master) return;
      if (math?.typesetPromise) await math.typesetPromise([state.reading]);
      if (token !== generation || !master || !wantsReading(state)) clearReading(node, state);
    }).catch(() => {});
  }

  async function renderState(node, state) {
    if (!wantsReading(state)) {
      if (state.revealed) clearReading(node, state);
      return;
    }
    if (state.revealed || state.pending) return;
    const token = generation;
    const key = master;
    const epoch = manifest?.epoch;
    state.pending = true;
    node.setAttribute('aria-busy', 'true');
    try {
      const html = await decryptBlock(node.dataset.sealed, epoch, key);
      if (token !== generation || !node.isConnected || !wantsReading(state)) return;
      const fragment = safeFragment(html);
      // The site's general MathJax configuration permits extension macros. Keep
      // resource/HTML commands out of this isolated reader before any typesetting.
      if (/\\(?:href|url|require|includegraphics|class|style|cssId|htmlClass|htmlId|htmlStyle|htmlData|def|gdef|edef|xdef|let|newcommand|renewcommand|providecommand|csname|expandafter|input|include|catcode)\b/i.test(fragment.textContent)) throw Error('Unsupported active TeX command');
      if (node.hasAttribute('data-part')) {
        const parts = [...fragment.childNodes].filter(child => child.nodeType !== 3 || child.textContent.trim());
        const part = parts[Number(node.dataset.part)];
        if (!part) throw Error('Missing paragraph');
        fragment.replaceChildren(part);
      }
      if (node.classList.contains('sealed-inline')) {
        // Inline Markdown is emitted as a single paragraph by the authoring app.
        // Move its sanitized children so a span never contains a block paragraph.
        const children = [...fragment.childNodes].filter(child => child.nodeType !== 3 || child.textContent.trim());
        if (children.length === 1 && children[0].nodeName === 'P') fragment.replaceChildren(...children[0].childNodes);
      }
      state.reading.replaceChildren(fragment);
      state.reading.hidden = false;
      state.revealed = true;
      node.dataset.revealed = 'true';
      state.button.setAttribute('aria-expanded', 'true');
      typesetReading(node, state, token);
    } catch {
      if (token === generation && node.isConnected) state.button.setAttribute('aria-label', '此段暂时无法解密，请刷新页面后重新验证');
    } finally {
      state.pending = false;
      node.removeAttribute('aria-busy');
    }
  }

  function prepareBlocks() {
    const pending = blocks();
    for (const node of pending) {
      if (states.has(node)) continue;
      const layout = node.querySelector(':scope > .sealed-placeholder')?.dataset.parts;
      if (!node.classList.contains('sealed-inline') && layout && /^(?:[1-9]|[1-3][0-9]|4[0-4])(?:,(?:[1-9]|[1-3][0-9]|4[0-4]))*$/.test(layout)) {
        const group = document.createElement('div');
        group.className = 'sealed-group';
        layout.split(',').forEach((width, index) => {
          const part = document.createElement('div');
          part.className = 'sealed-block sealed-part';
          part.dataset.sealed = node.dataset.sealed;
          part.dataset.part = String(index);
          part.style.setProperty('--sealed-width', width + 'em');
          group.append(part);
          pending.push(part);
        });
        node.replaceWith(group);
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sealed-toggle';
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', '黑幕内容');
      button.disabled = !master;
      const reading = document.createElement(node.classList.contains('sealed-inline') ? 'span' : 'div');
      reading.className = 'sealed-reading';
      reading.hidden = true;
      const state = {button, reading, hover: false, focus: false, pinned: false, revealed: false, pending: false};
      states.set(node, state);
      node.replaceChildren(button, reading);
      node.dataset.revealed = 'false';
      node.addEventListener('pointerenter', event => {
        if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
        state.hover = true;
        renderState(node, state);
      });
      node.addEventListener('pointerleave', () => { state.hover = false; renderState(node, state); });
      node.addEventListener('pointerdown', event => { lastPointerType = event.pointerType; });
      node.addEventListener('focusin', () => {
        if (lastPointerType !== 'keyboard') return;
        state.focus = true;
        renderState(node, state);
      });
      node.addEventListener('focusout', event => {
        if (event.relatedTarget && node.contains(event.relatedTarget)) return;
        state.focus = false;
        renderState(node, state);
      });
      node.addEventListener('click', event => {
        if (event.target.closest('a')) return;
        if (!master) return;
        // A pointer click must not fight the focus event or desktop hover.
        if (lastPointerType === 'mouse') return;
        state.focus = false;
        state.pinned = !state.pinned;
        renderState(node, state);
      });
    }
  }

  opener.addEventListener('click', openDialog);
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { clearTimeout(autoSubmitTimer); input.value = ''; });
  document.addEventListener('keydown', () => { lastPointerType = 'keyboard'; }, {capture: true});
  input.addEventListener('input', () => {
    clearTimeout(autoSubmitTimer);
    setStatus('');
    if (/^[0-9a-f]{32}$/i.test(input.value.replace(/[\s-]/gu, ''))) {
      autoSubmitTimer = setTimeout(() => { if (!busy && dialog.open) form.requestSubmit(); }, 180);
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    clearTimeout(autoSubmitTimer);
    if (busy) return;
    if (!crypto?.subtle) { setStatus('当前浏览器不支持加密验证，请使用较新的浏览器。', true); return; }
    busy = true;
    input.setAttribute('aria-busy', 'true');
    input.disabled = true;
    const code = input.value;
    input.value = '';
    setStatus('正在验证…');
    try {
      const currentManifest = await loadManifest(true);
      const token = ++generation;
      const raw = await unwrapCode(currentManifest, code);
      const nextKey = await importMaster(raw);
      if (generation !== token) return;
      master = nextKey;
      try { sessionStorage.setItem(storageKey, JSON.stringify({version: 1, epoch: currentManifest.epoch, key: base64(raw)})); } catch {}
      raw.fill(0);
      updateAccessUi();
      setStatus('通过');
      dialog.close();
      opener.focus();
    } catch {
      setStatus(manifest ? '访问码不正确、已失效，或验证资料暂时无法加载。请确认后重试。' : '验证资料暂时无法加载，请稍后重试。', true);
    } finally {
      busy = false;
      input.disabled = false;
      input.removeAttribute('aria-busy');
      if (dialog.open) input.focus();
    }
  });

  prepareBlocks();
  if (article) new MutationObserver(prepareBlocks).observe(article, {childList: true, subtree: true});
  // BFCache must not restore an already revealed secret without rechecking the epoch.
  window.addEventListener('pagehide', () => {
    generation++;
    master = null;
    for (const node of blocks()) {
      const state = states.get(node);
      if (state) { state.hover = state.focus = state.pinned = false; clearReading(node, state); }
    }
    updateAccessUi();
  });

  async function restoreSession() {
    try {
      const currentManifest = await loadManifest(true);
      const saved = sessionData();
      if (!saved || saved.version !== 1 || saved.epoch !== currentManifest.epoch) { forgetSession(); updateAccessUi(); return; }
      const token = generation;
      const key = await importMaster(unbase64(saved.key, 32));
      if (generation !== token) return;
      master = key;
      updateAccessUi();
    } catch { lock(false); }
  }
  window.addEventListener('pageshow', event => { if (event.persisted) restoreSession(); });
  restoreSession();
})();
