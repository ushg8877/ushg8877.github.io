(() => {
  'use strict';
  const origin = document.querySelector('#bird-trigger');
  if (!origin || !window.KamomeGame) return;
  const limit = 600;
  const layer = document.createElement('div');
  layer.className = 'bird-flight';
  layer.hidden = true;
  layer.innerHTML = '<button type="button" class="flying-bird" aria-label="继续点击，让小鸟飞得更高"></button><span class="sr-only flight-announcement" role="status" aria-live="polite"></span>';
  document.body.append(layer);
  const bird = layer.querySelector('.flying-bird');
  bird.append(origin.querySelector('svg').cloneNode(true));
  const announcement = layer.querySelector('.flight-announcement');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let active = false, height = 0, x = 0, y = 0, returnTimer = 0, unlockTimer = 0;
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

  function reset(focus = true) {
    clearTimeout(returnTimer); clearTimeout(unlockTimer);
    const restoreFocus = focus || layer.contains(document.activeElement);
    active = false; height = 0;
    layer.dataset.flightHeight = '0';
    layer.hidden = true; origin.disabled = false; origin.classList.remove('is-away');
    layer.querySelectorAll('.flight-wind,.flight-cloud').forEach(wind => wind.remove());
    bird.disabled = false;
    if (restoreFocus) origin.focus({ preventScroll: true });
  }
  function position() {
    x = clamp(x, 8, window.innerWidth - 84);
    y = clamp(y, 12, window.innerHeight - 180);
    bird.style.left = x + 'px'; bird.style.top = y + 'px';
  }
  function gust(oldX, oldY) {
    if (reduceMotion.matches) return;
    const wind = document.createElement('i');
    wind.className = 'flight-wind'; wind.setAttribute('aria-hidden', 'true');
    wind.style.left = oldX + 20 + 'px'; wind.style.top = oldY + 45 + 'px';
    layer.append(wind);
    wind.addEventListener('animationend', () => wind.remove(), { once: true });
    // Passing cloud outlines keep ascent visible once the bird reaches the
    // viewport's upper edge and the camera begins following it.
    const cloud = document.createElement('i');
    cloud.className = 'flight-cloud'; cloud.setAttribute('aria-hidden', 'true');
    cloud.style.left = clamp(oldX + 105, 10, window.innerWidth - 95) + 'px';
    cloud.style.top = oldY + 65 + 'px';
    layer.append(cloud);
    cloud.addEventListener('animationend', () => cloud.remove(), { once: true });
  }
  function lift(event) {
    if (!active || height >= limit) return;
    clearTimeout(returnTimer);
    const rect = bird.getBoundingClientRect();
    const clickY = event.detail === 0 ? rect.top + rect.height / 2 : event.clientY;
    const wind = 70 + Math.round(65 * clamp(1 - clickY / window.innerHeight, 0, 1));
    height = Math.min(limit, height + wind);
    gust(x, y);
    // The page is close to the ground; once at the top, the camera follows the
    // bird while the altitude meter continues upward with every wingbeat.
    x += 44 + height / 22;
    if (x > window.innerWidth - 90) x = Math.max(12, window.innerWidth * .45);
    y -= 28 + wind * .25;
    position();
    layer.dataset.flightHeight = String(height);
    announcement.textContent = '小鸟飞到了 ' + height + ' 米。';
    bird.setAttribute('aria-label', '飞行高度 ' + height + ' 米。继续点击小鸟。');
    if (height >= limit) {
      announcement.textContent = '发现彩蛋：海风邮差。';
      bird.disabled = true;
      unlockTimer = window.setTimeout(() => {
        layer.hidden = true;
        window.KamomeGame.open({ onClose: () => reset() });
      }, 0);
    } else {
      returnTimer = window.setTimeout(() => reset(false), 12000);
    }
  }
  origin.addEventListener('click', event => {
    if (active) return;
    const rect = origin.getBoundingClientRect();
    x = rect.left; y = rect.top; height = 0; active = true;
    layer.hidden = false; origin.disabled = true; origin.classList.add('is-away');
    bird.style.transition = 'none'; position();
    void bird.offsetWidth;
    bird.style.transition = '';
    bird.focus({ preventScroll: true });
    lift(event);
  });
  bird.addEventListener('click', lift);
  window.addEventListener('resize', () => { if (active) position(); });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active && !window.KamomeGame.isOpen()) {
      event.preventDefault(); reset();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active && !window.KamomeGame.isOpen()) reset(false);
  });
})();
