(() => {
  'use strict';
  const section = document.querySelector('[data-giscus-enabled="true"]');
  if (!section) return;

  const origin = 'https://giscus.app';
  const mount = section.querySelector('.giscus');
  const status = section.querySelector('.engagement-status');
  const retry = section.querySelector('.engagement-retry');
  const github = section.querySelector('.engagement-github');
  const config = section.dataset;
  let timer;
  let frame;
  let failure = '';
  let script;

  function theme() {
    return document.documentElement.dataset.theme === 'dark'
      ? (config.themeDark || 'transparent_dark') : (config.themeLight || 'light');
  }

  function updateTheme() {
    frame?.contentWindow?.postMessage({giscus: {setConfig: {theme: theme()}}}, origin);
  }

  function loading() {
    clearTimeout(timer);
    failure = '';
    status.textContent = '正在加载评论…';
    status.hidden = false;
    retry.hidden = true;
    mount.hidden = false;
    mount.setAttribute('aria-busy', 'true');
    timer = setTimeout(() => failed('timeout'), 18000);
  }

  function failed(reason) {
    clearTimeout(timer);
    failure = reason;
    status.textContent = reason === 'installation'
      ? '评论与点赞尚待站长完成启用。'
      : '评论暂时没能加载。可以重试，或前往 GitHub 查看。';
    status.hidden = false;
    retry.hidden = false;
    mount.hidden = true;
    mount.setAttribute('aria-busy', 'false');
  }

  function ready() {
    clearTimeout(timer);
    failure = '';
    status.hidden = true;
    retry.hidden = true;
    mount.hidden = false;
    mount.setAttribute('aria-busy', 'false');
  }

  function attachFrame() {
    const candidate = mount.querySelector('iframe.giscus-frame');
    if (!candidate || candidate === frame) return;
    frame = candidate;
    frame.title = '文章点赞与评论';
    frame.addEventListener('load', updateTheme);
    updateTheme();
  }

  function load() {
    loading();
    if (![config.repo, config.repoId, config.category, config.categoryId, config.term].every(Boolean)) {
      failed('configuration');
      return;
    }
    // Reuse the client listener on retries; a fresh iframe navigation reloads the discussion.
    attachFrame();
    if (frame) {
      frame.src = frame.src;
      return;
    }
    script?.remove();
    script = document.createElement('script');
    script.src = origin + '/client.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    const attributes = {
      repo: config.repo,
      'repo-id': config.repoId,
      category: config.category,
      'category-id': config.categoryId,
      // A server-rendered URL keeps every translation, query and fragment on one discussion.
      mapping: 'specific',
      term: config.term,
      strict: '1',
      'reactions-enabled': '1',
      'emit-metadata': '1',
      'input-position': 'top',
      theme: theme(),
      lang: 'zh-CN',
      loading: 'eager'
    };
    for (const [key, value] of Object.entries(attributes)) script.setAttribute('data-' + key, value);
    script.addEventListener('error', () => failed('network'), {once: true});
    mount.append(script);
  }

  window.addEventListener('message', event => {
    attachFrame();
    if (event.origin !== origin || !frame || event.source !== frame.contentWindow) return;
    const message = event.data?.giscus;
    if (!message || typeof message !== 'object') return;
    if (typeof message.error === 'string') {
      // No discussion yet is normal: giscus creates it with the first comment or reaction.
      if (/discussion not found/i.test(message.error)) ready();
      else failed(/not installed/i.test(message.error) ? 'installation' : 'service');
      return;
    }
    if (message.discussion && typeof message.discussion === 'object') {
      ready();
      try {
        const url = new URL(message.discussion.url);
        const prefix = '/' + config.repo + '/discussions/';
        if (url.origin === 'https://github.com' && url.pathname.startsWith(prefix) && /^\d+$/.test(url.pathname.slice(prefix.length))) {
          github.href = url.href;
          github.textContent = '在 GitHub 打开评论 ↗';
        }
      } catch {}
    } else if (Number.isFinite(message.resizeHeight) && message.resizeHeight > 0 && !['service', 'installation'].includes(failure)) {
      ready();
    }
  });

  new MutationObserver(attachFrame).observe(mount, {childList: true});
  new MutationObserver(updateTheme).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
  retry.addEventListener('click', load);
  load();
})();
