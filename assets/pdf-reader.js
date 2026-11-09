/* Article PDF reader. Only the current page is painted, and only after a reader opens the card. */
(() => {
  'use strict';
  const assetBase = new URL('./', document.currentScript.src);
  const libraryBase = new URL('pdfjs/', assetBase);
  const selector = 'div.pdf-embed[data-pdf]';
  const maxBytes = 20 * 1024 * 1024;
  const mounted = new WeakSet();
  let libraryPromise;
  let active;
  class AttachmentError extends Error {}

  function encode(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decode(value, size) {
    if (typeof value !== 'string' || !/^[\w-]+$/.test(value) || value.length > 4096) throw Error();
    const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    if ((size !== undefined && bytes.length !== size) || encode(bytes) !== value) throw Error();
    return bytes;
  }

  function readDescriptor(encoded) {
    const value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(decode(encoded)));
    if (!value || Object.keys(value).sort().join(',') !== 'bytes,id,iv,key,name,sha256,v' || value.v !== 1 ||
        typeof value.id !== 'string' || !/^[a-f0-9]{32}$/.test(value.id) ||
        typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) ||
        !Number.isInteger(value.bytes) || value.bytes < 15 || value.bytes > maxBytes ||
        typeof value.name !== 'string' || [...value.name].length > 160 || /[\/\\:\p{C}]/u.test(value.name) ||
        !/\.pdf$/i.test(value.name)) throw Error();
    decode(value.key, 32);
    decode(value.iv, 12);
    return value;
  }

  function cleanDescriptor(encoded) {
    try { return encode(new TextEncoder().encode(JSON.stringify(readDescriptor(encoded)))); }
    catch { return null; }
  }

  function getLibrary() {
    if (!libraryPromise) {
      libraryPromise = import(new URL('build/pdf.mjs', libraryBase).href).then(lib => {
        lib.GlobalWorkerOptions.workerSrc = new URL('build/pdf.worker.mjs', libraryBase).href;
        return lib;
      }).catch(error => { libraryPromise = null; throw error; });
    }
    return libraryPromise;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function action(key, label, text = label) {
    const button = element('button', 'pdf-button', text);
    button.type = 'button';
    button.dataset.pdfAction = key;
    button.setAttribute('aria-label', label);
    button.title = label;
    return button;
  }

  function cardHeader(info) {
    const header = element('div', 'pdf-heading');
    const details = element('div', 'pdf-details');
    const size = info.bytes >= 1048576 ? (info.bytes / 1048576).toFixed(1) + ' MiB' : Math.ceil(info.bytes / 1024) + ' KiB';
    details.append(element('strong', 'pdf-name', info.name), element('small', 'pdf-size', size));
    header.append(element('span', 'pdf-file-icon'), details);
    return header;
  }

  function drawCard(card, message = '') {
    let info;
    try { info = readDescriptor(card.dataset.pdf); }
    catch {
      card.replaceChildren(element('span', 'pdf-status', 'PDF 附件资料无效。'));
      return;
    }
    const header = cardHeader(info);
    header.append(action('open', '阅读 PDF'));
    card.replaceChildren(header);
    if (message) {
      const feedback = element('p', 'pdf-status pdf-error', message);
      feedback.setAttribute('role', 'status');
      card.append(feedback);
    }
  }

  function mount(card) {
    if (mounted.has(card)) return;
    mounted.add(card);
    drawCard(card);
  }

  function scan(root) {
    if (root.matches?.(selector)) mount(root);
    root.querySelectorAll?.(selector).forEach(mount);
  }

  function current(session) {
    return active === session && !session.abort.signal.aborted && session.card.isConnected &&
      session.card.dataset.pdf === session.encoded && !session.card.closest('[hidden]');
  }

  function assertCurrent(session) {
    if (!current(session)) throw new DOMException('Closed', 'AbortError');
  }

  async function loadBytes(info, session) {
    const response = await fetch(new URL('pdfs/media/' + info.id + '.bin', assetBase), {
      signal:session.abort.signal, redirect:'error', credentials:'omit', referrerPolicy:'no-referrer', cache:'no-store',
    });
    if (!response.ok || !response.body) throw new AttachmentError('PDF 附件暂时无法读取。');
    const expected = info.bytes + 16;
    const cipher = new Uint8Array(expected);
    const reader = response.body.getReader();
    let length = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        assertCurrent(session);
        if (done) break;
        if (length + value.length > expected) throw new AttachmentError('PDF 附件长度不正确。');
        cipher.set(value, length);
        length += value.length;
        session.status.textContent = '正在读取 PDF · ' + Math.floor(length * 100 / expected) + '%';
      }
    } finally { reader.releaseLock(); }
    if (length !== expected) throw new AttachmentError('PDF 附件不完整。');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', cipher));
    if ([...digest].map(b => b.toString(16).padStart(2, '0')).join('') !== info.sha256) throw new AttachmentError('PDF 附件校验失败。');
    assertCurrent(session);
    const secret = decode(info.key, 32);
    let key;
    try { key = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['decrypt']); }
    finally { secret.fill(0); }
    const plain = new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM', iv:decode(info.iv, 12), additionalData:new TextEncoder().encode('kamome-pdf:v1:' + info.id),
    }, key, cipher));
    if (!current(session) || !/^%PDF-[12]\.\d\s/.test(new TextDecoder().decode(plain.subarray(0, 12)))) {
      plain.fill(0);
      throw new AttachmentError('PDF 附件无法读取。');
    }
    return plain;
  }

  function wipe(canvas) {
    if (canvas) { canvas.width = 0; canvas.height = 0; canvas.remove(); }
  }

  function close(session = active, message = '', focus = false) {
    if (!session || session !== active) return;
    active = null;
    session.abort.abort();
    session.resize?.disconnect();
    clearTimeout(session.resizeTimer);
    session.render?.cancel();
    wipe(session.pendingCanvas);
    wipe(session.view.querySelector('canvas'));
    // Cancelling a loading task also terminates its worker and pending page requests.
    if (session.loading) Promise.resolve(session.loading.destroy()).catch(() => {});
    session.doc = null;
    session.encoded = null;
    for (const url of session.downloads) URL.revokeObjectURL(url);
    session.downloads.clear();
    if (document.fullscreenElement === session.card) document.exitFullscreen().catch(() => {});
    delete session.card.dataset.pdfExpanded;
    delete session.card.dataset.pdfMaximized;
    if (session.card.isConnected) {
      drawCard(session.card, message);
      if (focus) session.card.querySelector('[data-pdf-action=open]')?.focus({preventScroll:true});
    }
  }

  function closeWithin(node) {
    if (active && node?.contains(active.card)) close();
  }

  function controls(session) {
    const toolbar = element('div', 'pdf-tools');
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', 'PDF 阅读工具');
    session.prev = action('prev', '上一页', '‹');
    session.next = action('next', '下一页', '›');
    session.pageInput = element('input', 'pdf-page-number');
    session.pageInput.type = 'number';
    session.pageInput.inputMode = 'numeric';
    session.pageInput.min = 1;
    session.pageInput.dataset.pdfPage = '';
    session.pageInput.setAttribute('aria-label', '页码');
    session.total = element('span', 'pdf-page-total', '/ —');
    session.total.dataset.pdfTotal = '';
    const pages = element('div', 'pdf-page-tools');
    pages.append(session.prev, session.pageInput, session.total, session.next);
    session.zoom = element('select', 'pdf-zoom');
    session.zoom.setAttribute('aria-label', '缩放');
    session.zoom.dataset.pdfZoom = '';
    for (const [value, label] of [['fit','适合宽度'],['0.5','50%'],['0.75','75%'],['1','100%'],['1.25','125%'],['1.5','150%'],['2','200%']]) {
      const option = element('option', '', label);
      option.value = value;
      session.zoom.append(option);
    }
    const finish = element('div', 'pdf-file-tools');
    session.full = action('full', '全屏');
    session.full.setAttribute('aria-pressed', 'false');
    session.download = action('download', '下载 PDF', '下载');
    finish.append(session.full, session.download, action('close', '关闭 PDF', '关闭'));
    toolbar.append(pages, session.zoom, finish);
    return toolbar;
  }

  function updateControls(s) {
    s.prev.disabled = !s.doc || s.page <= 1;
    s.next.disabled = !s.doc || s.page >= s.doc.numPages;
    s.zoom.disabled = s.pageInput.disabled = s.download.disabled = !s.doc;
    s.pageInput.value = s.page;
    if (s.doc) {
      s.total.textContent = '/ ' + s.doc.numPages;
      s.pageInput.max = s.doc.numPages;
    }
  }

  async function paint(session) {
    if (!current(session) || !session.doc) return;
    const sequence = ++session.sequence;
    const wanted = session.page;
    session.render?.cancel();
    const valid = () => current(session) && session.sequence === sequence;
    updateControls(session);
    session.view.setAttribute('aria-busy', 'true');
    session.status.textContent = '正在显示第 ' + wanted + ' 页…';
    let canvas;
    try {
      const page = await session.doc.getPage(wanted);
      if (!valid()) return;
      const unit = page.getViewport({scale:1});
      if (!(unit.width > 0 && unit.height > 0 && Number.isFinite(unit.width + unit.height))) throw Error();
      const width = Math.max(1, session.view.clientWidth - 16);
      const zoom = session.zoom.value === 'fit' ? width / unit.width : Number(session.zoom.value) * 96 / 72;
      const scale = Math.min(zoom, 8192 / Math.max(unit.width, unit.height));
      const size = page.getViewport({scale});
      const density = Math.min(devicePixelRatio || 1, 2, 4096 / Math.max(size.width,size.height),
        Math.sqrt(8000000 / (size.width * size.height)));
      const viewport = page.getViewport({scale:scale * density});
      canvas = element('canvas', 'pdf-sheet');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = size.width + 'px';
      canvas.style.height = size.height + 'px';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'PDF 第 ' + wanted + ' 页');
      session.pendingCanvas = canvas;
      const render = page.render({canvas, viewport, annotationMode:session.lib.AnnotationMode.DISABLE});
      session.render = render;
      await render.promise;
      if (!valid()) return;
      wipe(session.view.querySelector('canvas'));
      canvas.dataset.page = wanted;
      session.view.replaceChildren(canvas);
      session.view.scrollTo(0, 0);
      session.pendingCanvas = null;
      session.render = null;
      canvas = null;
      session.status.textContent = '';
      page.cleanup();
    } catch {
      if (valid()) session.status.textContent = '此页暂时无法显示。';
    } finally {
      wipe(canvas);
      if (valid()) {
        session.pendingCanvas = null;
        session.render = null;
        session.view.removeAttribute('aria-busy');
      }
    }
  }

  function navigate(session, page) {
    if (!session.doc) return;
    const wanted = Number(page);
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > session.doc.numPages) {
      session.pageInput.value = session.page;
      return;
    }
    if (wanted !== session.page) { session.page = wanted; paint(session); }
  }

  async function open(card) {
    let info;
    try { info = readDescriptor(card.dataset.pdf); } catch { drawCard(card); return; }
    close();
    const session = {card, encoded:card.dataset.pdf, abort:new AbortController(), page:1, sequence:0, downloads:new Set()};
    active = session;
    session.view = element('div', 'pdf-viewport');
    session.view.tabIndex = 0;
    session.view.setAttribute('aria-label', 'PDF 页面');
    session.status = element('p', 'pdf-status');
    session.status.setAttribute('role', 'status');
    const toolbar = controls(session);
    updateControls(session);
    card.dataset.pdfExpanded = 'true';
    card.replaceChildren(cardHeader(info), toolbar, session.status, session.view);
    toolbar.querySelector('[data-pdf-action=close]').focus({preventScroll:true});
    session.status.textContent = '正在读取 PDF…';
    let bytes;
    try {
      session.lib = await getLibrary();
      assertCurrent(session);
      bytes = await loadBytes(info, session);
      assertCurrent(session);
      const lib = session.lib;
      session.loading = lib.getDocument({
        data:bytes, cMapUrl:new URL('cmaps/',libraryBase).href, cMapPacked:true,
        standardFontDataUrl:new URL('standard_fonts/',libraryBase).href, wasmUrl:new URL('wasm/',libraryBase).href,
        iccUrl:new URL('iccs/',libraryBase).href, enableXfa:false, disableWorkerRendering:true,
        maxImageSize:16777216, canvasMaxAreaInBytes:32000000,
      });
      session.doc = await session.loading.promise;
      assertCurrent(session);
      if (!session.doc.numPages) throw Error('empty');
      updateControls(session);
      let width = session.view.clientWidth;
      session.resize = new ResizeObserver(() => {
        if (!current(session) || session.zoom.value !== 'fit' || session.view.clientWidth === width) return;
        width = session.view.clientWidth;
        clearTimeout(session.resizeTimer);
        session.resizeTimer = setTimeout(() => paint(session), 80);
      });
      session.resize.observe(session.view);
      await paint(session);
    } catch (error) {
      let message = '无法读取 PDF，请检查附件后重试。';
      if (error instanceof AttachmentError) message = error.message;
      if (error.name === 'PasswordException') message = '此 PDF 自带密码，请先解除文档密码。';
      if (error.name === 'InvalidPDFException') message = 'PDF 文件损坏或格式不受支持。';
      if (active === session) close(session, message);
    } finally {
      if (bytes?.byteLength) bytes.fill(0);
    }
  }

  async function fullScreen(s) {
    if (s.card.dataset.pdfMaximized) {
      delete s.card.dataset.pdfMaximized;
    } else if (document.fullscreenElement === s.card) {
      await document.exitFullscreen().catch(() => {});
    } else {
      try { await s.card.requestFullscreen(); }
      catch { if (current(s)) s.card.dataset.pdfMaximized = 'true'; }
    }
    syncFullScreen();
  }

  function syncFullScreen() {
    if (!active) return;
    const expanded = document.fullscreenElement === active.card || active.card.hasAttribute('data-pdf-maximized');
    const label = expanded ? '退出全屏' : '全屏';
    active.full.textContent = label;
    active.full.setAttribute('aria-label', label);
    active.full.setAttribute('aria-pressed', String(expanded));
    active.full.title = label;
  }

  async function download(s) {
    if (!s.doc) return;
    try {
      const bytes = await s.doc.getData();
      if (!current(s)) { bytes.fill(0); return; }
      const url = URL.createObjectURL(new Blob([bytes], {type:'application/pdf'}));
      bytes.fill(0);
      s.downloads.add(url);
      const link = element('a');
      link.href = url;
      link.download = readDescriptor(s.encoded).name;
      link.click();
      setTimeout(() => { URL.revokeObjectURL(url); s.downloads.delete(url); }, 1000);
    } catch { if (current(s)) s.status.textContent = 'PDF 暂时无法下载。'; }
  }

  document.addEventListener('click', event => {
    const control = event.target.closest?.('button[data-pdf-action]');
    const card = control?.closest(selector);
    if (!card) return;
    const action = control.dataset.pdfAction;
    if (action === 'open') { open(card); return; }
    if (active?.card !== card) return;
    if (action === 'prev') navigate(active,active.page-1);
    if (action === 'next') navigate(active,active.page+1);
    if (action === 'close') close(active,'',true);
    if (action === 'full') fullScreen(active);
    if (action === 'download') download(active);
  });
  document.addEventListener('change', event => {
    if (!active || !active.card.contains(event.target)) return;
    if (event.target === active.zoom) paint(active);
    if (event.target === active.pageInput) navigate(active,active.pageInput.value);
  });
  document.addEventListener('keydown', event => {
    if (!active || !active.card.contains(event.target)) return;
    if (event.target === active.pageInput && event.key === 'Enter') {
      event.preventDefault(); navigate(active,active.pageInput.value);
    } else if (event.key === 'Escape' && active.card.dataset.pdfMaximized) {
      delete active.card.dataset.pdfMaximized; syncFullScreen();
    } else if (event.target === active.view && ['ArrowLeft','ArrowRight'].includes(event.key)) {
      event.preventDefault(); navigate(active, active.page + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });
  document.addEventListener('fullscreenchange', syncFullScreen);
  document.addEventListener('kamome-private-lock', () => close());
  document.addEventListener('kamome-sealed-lock', () => close());
  window.addEventListener('pagehide', () => close());
  window.KamomePDF = Object.freeze({cleanDescriptor, closeWithin});
  scan(document);
  new MutationObserver(changes => {
    if (active && !current(active)) close();
    for (const change of changes) {
      for (const node of change.addedNodes) if (node.nodeType === 1) scan(node);
      if (change.attributeName === 'data-pdf' && change.target.matches(selector)) drawCard(change.target);
    }
  }).observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['hidden','data-pdf']});
})();
