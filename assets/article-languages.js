(() => {
  'use strict';
  const body = document.querySelector('#article-body');
  const heading = document.querySelector('#article-title');
  if (!body || !heading) return;
  const versions = new Map([...document.querySelectorAll('template[data-article-version]')]
    .map(template => [template.dataset.articleVersion, template]));
  const buttons = [...document.querySelectorAll('[data-article-language]')];
  const controls = document.querySelector('.article-languages');
  const labels = {zh: '中文', ja: '日本語', en: 'English'};
  const tags = {zh: 'zh-CN', ja: 'ja', en: 'en'};
  let current = 'zh';
  let renderQueue = Promise.resolve();

  function requestedLanguage() {
    const explicit = new URLSearchParams(location.search).get('lang');
    if (explicit !== null) return explicit;
    try { return localStorage.getItem('article-language') || 'zh'; } catch { return 'zh'; }
  }

  async function applyLanguage(language, announce) {
    if (current !== language) {
      const math = window.MathJax;
      try { if (math?.startup?.promise) await math.startup.promise; } catch {}
      try { math?.typesetClear?.([body]); } catch {}
      const template = versions.get(language);
      body.replaceChildren(template.content.cloneNode(true));
      heading.textContent = template.dataset.title;
      heading.lang = body.lang = tags[language];
      document.title = template.dataset.title + " · Kamome's Blog";
      current = language;
      try { if (math?.typesetPromise) await math.typesetPromise([body]); } catch {}
    }
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.articleLanguage === language));
    if (announce) document.querySelector('#article-language-status').textContent = '已切换为' + labels[language];
  }

  function selectLanguage(requested, updateUrl = false) {
    const language = versions.has(requested) ? requested : 'zh';
    if (updateUrl) {
      const url = new URL(location.href);
      if (language === 'zh') url.searchParams.delete('lang');
      else url.searchParams.set('lang', language);
      history.replaceState(null, '', url);
      try { localStorage.setItem('article-language', language); } catch {}
    }
    // Serialize switches so a slow math render cannot overwrite a newer choice.
    renderQueue = renderQueue.then(() => applyLanguage(language, updateUrl));
  }
  for (const button of buttons) button.addEventListener('click', () => selectLanguage(button.dataset.articleLanguage, true));
  window.addEventListener('popstate', () => selectLanguage(requestedLanguage()));
  if (controls) controls.hidden = false;
  selectLanguage(requestedLanguage());
})();
