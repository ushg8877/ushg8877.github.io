(() => {
  'use strict';
  const bird = document.querySelector('#bird-trigger');
  if (!bird) return;
  const traveler = bird.querySelector('.bird-traveler');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let destination = null;
  let landingTimer;

  function land() {
    clearTimeout(landingTimer);
    if (!destination) return;
    bird.dataset.perch = destination;
    bird.setAttribute('aria-label', destination === 'left'
      ? '让小鸟飞到右边的枝头' : '让小鸟飞到左边的枝头');
    destination = null;
    delete bird.dataset.flight;
  }

  bird.addEventListener('click', () => {
    if (destination) return;
    destination = bird.dataset.perch === 'left' ? 'right' : 'left';
    if (motion.matches || document.hidden) {
      land();
      return;
    }
    bird.dataset.flight = destination;
    landingTimer = window.setTimeout(land, 1550);
  });
  bird.addEventListener('animationend', event => {
    if (event.target === traveler &&
        (event.animationName === 'bird-to-right' || event.animationName === 'bird-to-left')) land();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) land();
  });
  motion.addEventListener('change', land);
})();
