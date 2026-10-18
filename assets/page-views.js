(() => {
  'use strict';

  // Independent adapter for Vercount's public v2 API, checked 2026-10-18:
  // https://github.com/EvanNotFound/vercount/blob/main/apps/api/internal/api/log.go
  // The hosted /js sends location.href, so do not load it alongside this file.
  // Keep login parameters, language choices and preview versions out of analytics.
  if (window.__kamomePageViewsStarted) return;
  window.__kamomePageViewsStarted = true;

  const productionOrigin = 'https://ushg8877.github.io';
  const endpoint = 'https://events.vercount.one/api/v2/log';
  const metrics = ['page_pv', 'site_pv'];

  function firstVisit() {
    // Use the same first-party, non-identifying UV marker as the official client.
    const key = 'vercount_uv_ushg8877_github_io';
    const seen = () => document.cookie.split(';').some(item => item.trim() === key + '=1');
    try {
      if (seen()) return false;
      document.cookie = key + '=1; path=/; max-age=31536000; samesite=lax; secure';
      // With cookies disabled, still count the page view without claiming a new UV.
      return seen();
    } catch {
      return false;
    }
  }

  async function start() {
    const elements = metrics.map(metric => [metric, document.getElementById('vercount_value_' + metric)])
      .filter(([, element]) => element);
    if (!elements.length) return;

    const showUnavailable = (state, label) => {
      for (const [, element] of elements) {
        element.textContent = '—';
        element.dataset.viewsState = state;
        element.setAttribute('aria-label', label);
        element.title = label;
      }
    };

    if (location.origin !== productionOrigin) {
      showUnavailable('preview', '本地预览不统计浏览量');
      return;
    }

    showUnavailable('loading', '浏览量加载中');
    if (typeof fetch !== 'function' || typeof AbortController !== 'function') {
      showUnavailable('unavailable', '浏览量暂不可用');
      return;
    }

    const url = new URL(productionOrigin);
    url.pathname = location.pathname;
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      try {
        const target = new URL(canonical.href, productionOrigin);
        if (target.origin === productionOrigin) url.pathname = target.pathname;
      } catch { /* Fall back to this page's own path. */ }
    }
    url.search = '';
    url.hash = '';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      // A single POST records one actual document visit. Never retry a failed POST:
      // the server may already have counted it before the connection was interrupted.
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        credentials: 'omit',
        referrerPolicy: 'origin',
        signal: controller.signal,
        body: JSON.stringify({url: url.href, isNewUv: firstVisit()})
      });
      if (!response.ok) throw new Error('Counter unavailable');
      const result = await response.json();
      if (result?.status !== 'success' || !result.data) throw new Error('Invalid counter response');
      for (const [metric] of elements) {
        if (!Number.isSafeInteger(result.data[metric]) || result.data[metric] < 0) {
          throw new Error('Invalid counter value');
        }
      }
      for (const [metric, element] of elements) {
        const formatted = result.data[metric].toLocaleString('zh-CN');
        element.textContent = formatted;
        element.dataset.viewsState = 'ready';
        element.setAttribute('aria-label', formatted);
        element.removeAttribute('title');
      }
    } catch {
      showUnavailable('unavailable', '浏览量暂不可用');
    } finally {
      clearTimeout(timeout);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, {once: true});
  } else {
    start();
  }
})();
