(() => {
  'use strict';
  const bird = document.querySelector('#bird-trigger');
  if (!bird) return;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let returnTimer;
  function land() {
    clearTimeout(returnTimer);
    bird.classList.remove('is-fluttering');
  }
  bird.addEventListener('click', () => {
    if (motion.matches || bird.classList.contains('is-fluttering')) return;
    bird.classList.add('is-fluttering');
    returnTimer = window.setTimeout(land, 2100);
  });
  bird.addEventListener('animationend', event => {
    if (event.animationName === 'bird-short-flight') land();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) land();
  });
  motion.addEventListener('change', land);
})();