(() => {
  'use strict';
  const bird = document.querySelector('#bird-trigger');
  if (!bird) return;
  const traveler = bird.querySelector('.bird-traveler');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let destination = null;
  let landingTimer;
  let bloomTimer;

  function land() {
    clearTimeout(landingTimer);
    if (!destination) return;
    bird.dataset.perch = destination;
    bird.setAttribute('aria-label', destination === 'left'
      ? '轻触百合，让小鸟飞到右边' : '轻触百合，让小鸟飞到左边');
    destination = null;
    delete bird.dataset.flight;
  }

  function rest() {
    land();
    clearTimeout(bloomTimer);
    delete bird.dataset.bloom;
  }

  bird.addEventListener('click', () => {
    if (destination) return;
    destination = bird.dataset.perch === 'left' ? 'right' : 'left';
    if (motion.matches || document.hidden) {
      rest();
      return;
    }
    clearTimeout(bloomTimer);
    delete bird.dataset.bloom;
    // Restart only this small SVG's flourish, without creating particle nodes.
    void bird.offsetWidth;
    bird.dataset.bloom = '';
    bird.dataset.flight = destination;
    landingTimer = window.setTimeout(land, 1650);
    bloomTimer = window.setTimeout(() => { delete bird.dataset.bloom; }, 2300);
  });
  bird.addEventListener('animationend', event => {
    if (event.target === traveler &&
        (event.animationName === 'bird-to-right' || event.animationName === 'bird-to-left')) land();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) rest();
  });
  window.addEventListener('pagehide', rest);
  motion.addEventListener('change', rest);
})();
