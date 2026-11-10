/* Article PDF reader. Pages share a scrollable surface. Rasterize only pages near the viewport. */
(() => {
  'use strict';
  const assetBase = new URL('./', document.currentScript.src);
  const libraryBase = new URL('pdfjs/', assetBase);
  const selector = 'div.pdf-embed[data-pdf]';
  const legacyLimit = 20 * 1024 * 1024;
  const maxBytes = 100 * 1024 * 1024;
  const chunkSize = 8 * 1024 * 1024;
  const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
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
    if (!value || typeof value !== 'object' ||
        typeof value.id !== 'string' || !/^[a-f0-9]{32}$/.test(value.id) ||
        !Number.isInteger(value.bytes) || value.bytes < 15 || value.bytes > maxBytes ||
        typeof value.name !== 'string' || [...value.name].length > 160 || /[\/\\:\p{C}]/u.test(value.name) ||
        !/\.pdf$/i.test(value.name)) throw Error();
    decode(value.key, 32);
    const fields = Object.keys(value).sort().join(',');
    if (value.v === 1 && fields === 'bytes,id,iv,key,name,sha256,v') {
      if (value.bytes > legacyLimit || !validHash(value.sha256)) throw Error();
      decode(value.iv, 12);
    } else if (value.v === 2 && fields === 'bytes,hashes,id,key,name,nonce,v') {
      if (value.bytes <= legacyLimit || !Array.isArray(value.hashes) ||
          value.hashes.length !== Math.ceil(value.bytes / chunkSize) || !value.hashes.every(validHash)) throw Error();
      decode(value.nonce, 8);
    } else throw Error();
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

  async function fetchCipher(path, expected, session, progress) {
    assertCurrent(session);
    const response = await fetch(new URL('pdfs/media/' + path, assetBase), {
      signal:session.abort.signal, redirect:'error', credentials:'omit', referrerPolicy:'no-referrer', cache:'no-store',
    });
    if (!response.ok || !response.body) throw new AttachmentError('PDF 附件暂时无法读取。');
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
        progress(length);
      }
    } finally { reader.releaseLock(); }
    if (length !== expected) throw new AttachmentError('PDF 附件不完整。');
    return cipher;
  }

  async function loadBytes(info, session) {
    const secret = decode(info.key, 32);
    let key;
    try { key = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['decrypt']); }
    finally { secret.fill(0); }
    const chunked = info.v === 2;
    const hashes = chunked ? info.hashes : [info.sha256];
    const encryptedSize = info.bytes + 16 * hashes.length;
    let completed = 0, lastPercent = -1;
    let pdf = chunked ? new Uint8Array(info.bytes) : null;
    session.partialPdf = pdf;
    try {
      for (const [index, hash] of hashes.entries()) {
        const length = chunked ? Math.min(chunkSize, info.bytes - index * chunkSize) : info.bytes;
        const path = chunked ? `${info.id}/${index}.bin` : `${info.id}.bin`;
        const cipher = await fetchCipher(path, length + 16, session, received => {
          const percent = Math.floor((completed + received) * 100 / encryptedSize);
          if (percent !== lastPercent) session.status.textContent = `正在读取 PDF · ${percent}%`;
          lastPercent = percent;
        });
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', cipher));
        if ([...digest].map(b => b.toString(16).padStart(2, '0')).join('') !== hash) throw new AttachmentError('PDF 附件校验失败。');
        assertCurrent(session);
        const iv = new Uint8Array(12);
        iv.set(decode(chunked ? info.nonce : info.iv, chunked ? 8 : 12));
        if (chunked) new DataView(iv.buffer).setUint32(8, index, false);
        const aad = chunked ? `kamome-pdf:v2:${info.id}:${info.bytes}:${index}` : `kamome-pdf:v1:${info.id}`;
        const block = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv, additionalData:new TextEncoder().encode(aad)}, key, cipher));
        if (chunked) {
          try { assertCurrent(session); pdf.set(block, index * chunkSize); }
          finally { block.fill(0); }
        } else pdf = block;
        completed += cipher.length;
      }
      assertCurrent(session);
      if (!/^%PDF-[12]\.\d\s/.test(new TextDecoder().decode(pdf.subarray(0, 12)))) throw new AttachmentError('PDF 附件无法读取。');
      return pdf;
    } catch (error) {
      pdf?.fill(0);
      throw error;
    } finally {
      session.partialPdf = null;
    }
  }

  function wipe(canvas) {
    if (canvas) { canvas.width = 0; canvas.height = 0; canvas.remove(); }
  }

  function close(session = active, message = '', focus = false) {
    if (!session || session !== active) return;
    active = null;
    session.abort.abort();
    session.partialPdf?.fill(0);
    session.partialPdf = null;
    session.resize?.disconnect();
    cancelAnimationFrame(session.frame);
    if (session.slots) {
      for (const slot of session.slots.values()) releaseSlot(slot);
      session.slots.clear();
    }
    session.view.replaceChildren();
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
    if (!s.editingPage) s.pageInput.value = s.page;
    if (s.doc) {
      s.total.textContent = '/ ' + s.doc.numPages;
      s.pageInput.max = s.doc.numPages;
    }
  }

  const pageGap = 12;
  const inset = 8;
  const pixelBudget = 12000000;

  function dimensions(page) {
    const {width, height} = page.getViewport({scale:1});
    if (!(width > 0 && height > 0 && Number.isFinite(width + height))) throw Error('Invalid page size');
    return {width, height};
  }

  function scaledSize(s, number) {
    const unit = s.units.get(number) || s.defaultUnit;
    const scale = Math.min(s.zoomValue === 'fit' ? s.available / unit.width : Number(s.zoomValue) * 96/72,
                           8192 / Math.max(unit.width, unit.height));
    return {width:Math.max(1, unit.width * scale), height:Math.max(1, unit.height * scale), scale};
  }

  // Most pages share a paper size. Keep offsets only for pages known to differ
  // from page one. Even a long document needs just a handful of live DOM nodes.
  function pageTop(s, number) {
    let low = 0, high = s.adjustments.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (s.adjustments[mid].number < number) low = mid + 1;
      else high = mid;
    }
    return (number - 1) * s.stride + (low ? s.adjustments[low - 1].delta : 0);
  }

  function pageAt(s, y) {
    let low = 1, high = s.doc.numPages;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (pageTop(s, mid) <= y) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  function anchor(s) {
    if (s.jump && Math.abs(s.view.scrollTop - s.jump.top) > 1) s.jump = null;
    const number = pageAt(s, s.view.scrollTop);
    const size = scaledSize(s, number);
    return {
      number,
      bottom:s.view.scrollTop > 0 && s.view.scrollTop + s.view.clientHeight >= s.view.scrollHeight-1,
      y:(s.view.scrollTop - pageTop(s, number)) / size.height,
      x:(s.view.scrollLeft + s.view.clientWidth/2 - inset - (s.stackWidth - size.width)/2) / size.width,
    };
  }

  function releasePaint(slot) {
    slot.version++;
    slot.task?.cancel();
    slot.task = null;
    wipe(slot.canvas);
    slot.canvas = null;
    slot.ready = false;
    slot.failure?.remove();
    slot.failure = null;
  }

  function releaseSlot(slot) {
    releasePaint(slot);
    slot.node.remove();
  }

  function positionSlot(s, slot) {
    const size = scaledSize(s, slot.number);
    const density = rasterDensity(s, size);
    if (slot.scale !== size.scale || slot.density !== density) releasePaint(slot);
    slot.scale = size.scale;
    slot.density = density;
    Object.assign(slot.node.style, {
      top:pageTop(s, slot.number) + 'px', width:size.width + 'px', height:size.height + 'px',
      left:Math.max(0,(s.stackWidth - size.width)/2) + 'px',
    });
  }

  function layoutPages(s, location) {
    s.available = Math.max(1,s.view.clientWidth - 2*inset);
    s.zoomValue = s.zoom.value;
    const first = scaledSize(s, 1);
    s.stride = first.height + pageGap;
    s.stackWidth = Math.max(s.available, first.width);
    s.adjustments = [];
    let delta = 0;
    for (const number of [...s.units.keys()].sort((a,b) => a-b)) {
      const size = scaledSize(s, number);
      delta += size.height - first.height;
      s.adjustments.push({number, delta});
      s.stackWidth = Math.max(s.stackWidth, size.width);
    }
    s.stack.style.width = s.stackWidth + 'px';
    s.stack.style.height = (pageTop(s, s.doc.numPages + 1) - pageGap) + 'px';
    s.height = s.view.clientHeight;
    for (const slot of s.slots.values()) positionSlot(s, slot);
    if (location) {
      const size = scaledSize(s, location.number);
      if (s.jump) s.view.scrollTop = pageTop(s, s.jump.number);
      else if (location.bottom) s.view.scrollTop = s.view.scrollHeight;
      else s.view.scrollTop = pageTop(s, location.number) + location.y * size.height;
      s.view.scrollLeft = (s.stackWidth - size.width)/2 + size.width*location.x + inset - s.view.clientWidth/2;
      if (s.jump) s.jump.top = s.view.scrollTop;
    }
    schedule(s);
  }

  function schedule(s) {
    if (!current(s) || s.frame) return;
    s.frame = requestAnimationFrame(() => {
      s.frame = 0;
      if (current(s)) updateWindow(s);
    });
  }

  function updateWindow(s) {
    const top = s.view.scrollTop, height = s.view.clientHeight;
    const first = pageAt(s, top - inset);
    const last = pageAt(s, top + height - inset);
    if (s.jump && Math.abs(top-s.jump.top) > 1) s.jump = null;
    const bottom = top > 0 && top + height >= s.view.scrollHeight - 1;
    s.page = s.jump?.number || (bottom ? s.doc.numPages : pageAt(s, top + height/4 - inset));
    updateControls(s);
    const from = Math.max(1, first-1), to = Math.min(s.doc.numPages,last+1);
    for (const [number, slot] of s.slots) {
      if (number < from || number > to) { releaseSlot(slot); s.slots.delete(number); }
    }
    for (let number = to; number >= from; number--) {
      if (s.slots.has(number)) continue;
      const node = element('div','pdf-page');
      node.dataset.pageNumber = number;
      const slot = {number, node, version:0};
      positionSlot(s, slot);
      s.slots.set(number, slot);
      // Keep the DOM's reading order consistent even when scrolling backwards.
      s.stack.insertBefore(node, s.slots.get(number+1)?.node || null);
    }
    if (s.painting) return;
    const candidates = [...s.slots.values()].filter(slot => !slot.ready && !slot.failure);
    candidates.sort((a,b) => Number(b.number>=first && b.number<=last)-Number(a.number>=first && a.number<=last)
                               || Math.abs(a.number-s.page)-Math.abs(b.number-s.page));
    if (candidates.length) paintSlot(s,candidates[0]);
  }

  function rasterDensity(s, size) {
    // At most four pages straddle the viewport edges or sit just outside.
    // Interior pages share the remaining budget in proportion to their
    // heights. The allocation therefore doesn't depend on render order.
    let limit = Math.min(4000000, pixelBudget / s.doc.numPages);
    if (s.doc.numPages > 6) {
      limit = Math.min(pixelBudget/6, pixelBudget/3 * size.height / Math.max(1,s.view.clientHeight));
    }
    return Math.min(devicePixelRatio || 1, 2, 4096/Math.max(size.width,size.height),
                    Math.sqrt(limit / (size.width*size.height)));
  }

  async function paintSlot(s, slot) {
    s.painting = true;
    const attached = () => current(s) && s.slots.get(slot.number) === slot;
    let page, task;
    try {
      page = await s.doc.getPage(slot.number);
      if (!attached()) return;
      const unit = dimensions(page);
      if (!s.units.has(slot.number) && (unit.width !== s.defaultUnit.width || unit.height !== s.defaultUnit.height)) {
        const location = anchor(s);
        s.units.set(slot.number, unit);
        layoutPages(s, location);
        updateWindow(s);
        if (!attached()) return;
      }
      const version = slot.version;
      const size = scaledSize(s, slot.number);
      const viewport = page.getViewport({scale:size.scale*slot.density});
      const canvas = element('canvas','pdf-sheet');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.setAttribute('role','img');
      canvas.setAttribute('aria-label','PDF 第 ' + slot.number + ' 页');
      slot.canvas = canvas;
      task = page.render({canvas, viewport, annotationMode:s.lib.AnnotationMode.DISABLE});
      slot.task = task;
      await task.promise;
      if (!attached() || slot.version !== version) return;
      canvas.dataset.page = slot.number;
      slot.node.replaceChildren(canvas);
      slot.ready = true;
    } catch (error) {
      if (attached() && (!task || slot.task === task) && error.name !== 'RenderingCancelledException') {
        releasePaint(slot);
        slot.failure = element('span','pdf-page-error','第 ' + slot.number + ' 页暂时无法显示。');
        slot.node.append(slot.failure);
      }
    } finally {
      if (slot.task === task) slot.task = null;
      page?.cleanup();
      s.painting = false;
      schedule(s);
    }
  }

  function navigate(s, value) {
    if (!s.stack) return;
    s.editingPage = false;
    const number = Number(value);
    if (Number.isInteger(number) && number >= 1 && number <= s.doc.numPages) {
      s.view.scrollTop = pageTop(s, number);
      s.page = number;
      s.jump = {number, top:s.view.scrollTop};
      updateWindow(s);
    }
    s.pageInput.value = s.page;
  }

  async function startPages(s) {
    const first = await s.doc.getPage(1);
    assertCurrent(s);
    s.defaultUnit = dimensions(first);
    s.slots = new Map();
    s.units = new Map();
    s.stack = element('div','pdf-pages');
    s.view.append(s.stack);
    layoutPages(s);
    s.view.addEventListener('scroll', () => schedule(s), {passive:true});
    s.resize = new ResizeObserver(() => {
      if (!current(s)) return;
      if (Math.abs(s.available - (s.view.clientWidth-2*inset)) > .5 || s.height !== s.view.clientHeight) layoutPages(s, anchor(s));
      else schedule(s);
    });
    s.resize.observe(s.view);
    s.status.textContent = '';
    updateWindow(s);
  }

  async function open(card) {
    let info;
    try { info = readDescriptor(card.dataset.pdf); } catch { drawCard(card); return; }
    close();
    const session = {card, encoded:card.dataset.pdf, abort:new AbortController(), page:1, downloads:new Set()};
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
      await startPages(session);
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
    if (event.target === active.zoom && active.stack) layoutPages(active, anchor(active));
    if (event.target === active.pageInput) navigate(active,active.pageInput.value);
  });
  document.addEventListener('input', event => {
    if (active && event.target === active.pageInput) active.editingPage = true;
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
