(() => {
  'use strict';
  const main = document.querySelector('main');
  if (!main || !window.HTMLDialogElement) return;
  const selector = '#article-body.prose img';
  const excluded = 'button, .katex, mjx-container, .poll-embed, .pdf-embed';
  let viewer = null;
  let active = null;

  function prepare(image) {
    if (!image.matches(selector) || image.closest(excluded)) return;
    image.dataset.imageZoom = '';
    if (!image.closest('a')) {
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-haspopup', 'dialog');
      image.setAttribute('aria-label', image.alt ? '放大图片，' + image.alt : '放大图片');
    }
  }
  function close() {
    if (!viewer) return;
    const previous = active;
    const dialog = viewer;
    viewer = active = null;
    dialog.close();
    dialog.querySelector('img').removeAttribute('src');
    dialog.remove();
    if (previous?.isConnected && !previous.closest('[hidden], [inert]')) {
      (previous.closest('a') || previous).focus({preventScroll: true});
    }
  }
  function open(image) {
    if (viewer || image.closest('[hidden], [inert], [aria-hidden="true"]') || !image.naturalWidth) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'article-image-viewer';
    dialog.setAttribute('aria-label', '图片大图');
    // The template is constant. Image captions and URLs are assigned through the DOM.
    dialog.innerHTML = '<header><button type="button" class="viewer-size">原始大小</button><button autofocus type="button" class="viewer-close">关闭</button></header><div class="article-image-stage"><img alt=""></div><p class="viewer-caption"></p>';
    const large = dialog.querySelector('img');
    large.alt = image.alt;
    large.referrerPolicy = 'no-referrer';
    large.src = image.currentSrc || image.src;
    const caption = dialog.querySelector('.viewer-caption');
    const label = image.closest('.captioned-image, figure')?.querySelector('figcaption, .image-caption');
    caption.textContent = label?.textContent.trim() || '';
    caption.hidden = !caption.textContent;
    const anchor = image.closest('a[href]');
    if (anchor && /^(https?:|mailto:)$/.test(anchor.protocol)) {
      const link = document.createElement('a');
      link.href = anchor.href;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      link.textContent = '打开图片链接';
      dialog.querySelector('header').prepend(link);
    }
    const size = dialog.querySelector('.viewer-size');
    size.addEventListener('click', () => {
      const original = dialog.toggleAttribute('data-original');
      size.textContent = original ? '适应屏幕' : '原始大小';
    });
    dialog.querySelector('.viewer-close').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => {
      if (event.target === dialog || event.target.matches('.article-image-stage')) close();
    });
    viewer = dialog;
    active = image;
    document.body.append(dialog);
    dialog.showModal();
  }

  main.querySelectorAll(selector).forEach(prepare);
  new MutationObserver(records => {
    if (active && !active.isConnected) close();
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches('img')) prepare(node);
        else node.querySelectorAll('img').forEach(prepare);
      }
    }
  }).observe(main, {childList: true, subtree: true});
  main.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const image = event.target.closest('img[data-image-zoom]') ||
      (event.detail === 0 && event.target.closest('a')?.querySelector('img[data-image-zoom]'));
    if (image && image.naturalWidth) {
      event.preventDefault();
      open(image);
    }
  });
  main.addEventListener('keydown', event => {
    if (event.target.matches('img[data-image-zoom]') && !event.target.closest('a') && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      open(event.target);
    }
  });
  document.addEventListener('kamome-sealed-lock', close);
  document.addEventListener('kamome-private-lock', close);
  window.addEventListener('pagehide', close);
})();
