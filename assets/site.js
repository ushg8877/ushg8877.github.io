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

// Keep each excerpt's line breaks and song link together.
const quotes = [
  {
    lines: ['本当の明日の空まで', '続いていくから Shiny Days'],
    title: 'GLORIOUS DAYS', artist: 'yuiko', songId: '410925724', lang: 'ja'
  },
  {
    lines: ['幾億もの涙が作る世界', 'ねぇ 気付いてたの', '最初の言葉 繰り返して'],
    title: '東の空から始まる世界', artist: 'yuiko', songId: '410446173', lang: 'ja'
  },
  {
    lines: ['時の魔法を唱えよう ゼロからonce again'],
    title: '時の魔法', artist: '小木曽雪菜', songId: '775895', lang: 'ja'
  },
  {
    lines: ['Shining star　はるかな星めぐりの旅', '君との記憶を乗せて走ってく'],
    title: 'スタートリップ', artist: '保科めぐみ', songId: '1860844272', lang: 'ja'
  },
  {
    lines: ['Truly love forever.', 'I never lost my wish.', 'Just begin new world.'],
    title: 'last fortune', artist: 'fripSide', songId: '725111', lang: 'en'
  },
  {
    lines: ['つまり僕には僕の形があり 君には君の居場所がある', 'だからいくら 迷おうと終点は一つしかないらしい'],
    title: 'SOLVED9', artist: '', songId: '3331649221', lang: 'ja'
  }
];
const quote = document.querySelector('#hero-quote');
const songLink = document.querySelector('.song-link');
if (quote && songLink) {
  const selected = quotes[Math.floor(Math.random() * quotes.length)];
  const bracket = value => {
    const span = document.createElement('span');
    span.className = 'quote-bracket';
    span.textContent = value;
    return span;
  };
  quote.replaceChildren(...selected.lines.map((line, index) => {
    const span = document.createElement('span');
    span.className = 'quote-line';
    if (index === 0) span.append(bracket('『'));
    span.append(document.createTextNode(line));
    if (index === selected.lines.length - 1) span.append(bracket('』'));
    return span;
  }));
  quote.closest('h1').lang = selected.lang;
  songLink.href = 'https://music.163.com/song?id=' + selected.songId;
  songLink.setAttribute('aria-label', '收听 ' + (selected.artist ? selected.artist + ' 的 ' : '') + selected.title + '（新窗口）');
  songLink.querySelector('.song-title').textContent = selected.title;
  const artist = songLink.querySelector('.song-artist');
  artist.textContent = selected.artist ? '— ' + selected.artist : '';
  artist.hidden = !selected.artist;
}
