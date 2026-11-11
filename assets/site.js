const themeButton = document.querySelector('#theme');
function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  themeButton?.setAttribute('aria-pressed', String(dark));
  themeButton?.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
  const label = themeButton?.querySelector('span');
  if (label) label.textContent = dark ? '浅色模式' : '深色模式';
}
themeButton?.addEventListener('click', () => {
  const value = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem('theme', value); } catch (e) {}
  updateThemeButton();
});
updateThemeButton();

const search = document.querySelector('#search');
const cards = [...document.querySelectorAll('.post-card')];
const tags = [...document.querySelectorAll('[data-tag]')];
const requestedTag = new URLSearchParams(location.search).get('tag') || '';
let selectedTag = tags.some(button => button.dataset.tag === requestedTag) ? requestedTag : '';
function filterPosts(announce = true) {
  const query = (search?.value || '').trim().toLocaleLowerCase();
  let count = 0;
  for (const card of cards) {
    const matches = (!selectedTag || card.dataset.tags.split('|').includes(selectedTag)) && (card.dataset.title + ' ' + card.dataset.tags).toLocaleLowerCase().includes(query);
    card.hidden = !matches;
    if (matches) count++;
  }
  for (const button of tags) {
    const active = button.dataset.tag === selectedTag;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const empty = document.querySelector('#no-results');
  if (empty) empty.hidden = cards.length === 0 || count > 0;
  const status = document.querySelector('#search-status');
  if (status && announce) status.textContent = '找到 ' + count + ' 篇文章';
}
search?.addEventListener('input', () => filterPosts());
for (const button of tags) button.addEventListener('click', () => { selectedTag = button.dataset.tag; filterPosts(); });
if (search) filterPosts(false);

(() => {
  function captionedImage(image, text, standalone) {
    const doc = image.ownerDocument;
    const wrapper = doc.createElement(standalone ? 'figure' : 'span');
    wrapper.className = 'captioned-image tex2jax_ignore';
    const caption = doc.createElement(standalone ? 'figcaption' : 'span');
    if (!standalone) caption.className = 'image-caption';
    caption.textContent = text;
    wrapper.append(image, caption);
    return wrapper;
  }

  // Jekyll's Markdown fallback emits an image title when no prepared HTML exists.
  function formatTitles(body) {
    for (const wrapper of body.querySelectorAll('.captioned-image')) wrapper.classList.add('tex2jax_ignore');
    for (const image of body.querySelectorAll('img[title]')) {
      const text = image.title.trim();
      if (!text || image.closest('figure,.captioned-image')) continue;
      const paragraph = image.parentElement;
      const standalone = paragraph?.tagName === 'P'
        && [...paragraph.childNodes].every(node => node === image ||
          (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()));
      const original = standalone ? paragraph : image;
      const marker = image.ownerDocument.createTextNode('');
      original.replaceWith(marker);
      image.removeAttribute('title');
      marker.replaceWith(captionedImage(image, text, standalone));
    }
  }
  const body = document.getElementById('article-body');
  if (body) formatTitles(body);
  for (const template of document.querySelectorAll('template[data-article-version]')) formatTitles(template.content);

  // A protected caption is plain text paired with an image accepted by that reader's sanitizer.
  function copy(source, target, copyNodes) {
    if (!source.matches('figure.captioned-image,span.captioned-image')) return false;
    const standalone = source.tagName === 'FIGURE';
    const [image, caption] = source.children;
    if (source.children.length !== 2 || image.tagName !== 'IMG' ||
        !caption.matches(standalone ? 'figcaption' : 'span.image-caption')) return false;
    const clean = document.createDocumentFragment();
    copyNodes([image], clean);
    if (clean.firstElementChild) {
      target.append(captionedImage(clean.firstElementChild, caption.textContent, standalone));
    }
    return true;
  }
  window.KamomeImageCaptions = { copy };
})();
