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

// Punctuation stays in the HTML so script updates cannot remove it.
const quotes = ['本当の明日の空まで 続いていくから Shiny Days'];
const quote = document.querySelector('#hero-quote');
if (quote) quote.textContent = quotes[Math.floor(Math.random() * quotes.length)];
