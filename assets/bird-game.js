/* A small, self-contained surprise for Kamome's Blog. No network or dependencies. */
(() => {
  'use strict';
  if (window.KamomeGame) return;

  const TARGET = 12;
  const STORAGE_KEY = 'kamome-bird-mail-best';
  const HEIGHT = 480;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const random = (lo, hi) => lo + Math.random() * (hi - lo);
  const bodyPath = new Path2D('M8 34c7 2 13 0 18-5-1-10 5-17 14-17 8 0 13 6 13 13l10 5-11 4c-3 12-14 19-27 14C16 45 11 40 8 34Z');
  const wingPath = new Path2D('M17 34c7 1 15-2 22-9 2 13-7 20-22 9Z');
  let session = null;

  function readBest() {
    try {
      const best = Number(localStorage.getItem(STORAGE_KEY));
      return Number.isFinite(best) ? clamp(Math.floor(best), 0, TARGET) : 0;
    } catch (_) { return 0; }
  }

  function open(options = {}) {
    if (session) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const controller = new AbortController();
    const listen = (node, type, callback, extra = {}) => node.addEventListener(type, callback, { ...extra, signal: controller.signal });
    const dialog = document.createElement('dialog');
    dialog.className = 'bird-game';
    dialog.setAttribute('aria-label', '海风邮差');
    dialog.innerHTML = `
      <div class="bird-game-stage">
        <canvas tabindex="0" aria-label="海风邮差游戏画面。按空格或向上键拍翅，按 P 暂停，按 Escape 返回博客。">请使用支持 Canvas 的浏览器游玩。</canvas>
        <div class="bird-game-hud">
          <span class="bird-game-score" aria-label="收集信件"><svg viewBox="0 0 28 28" aria-hidden="true"><rect x="3" y="6" width="22" height="16" rx="1"/><path d="m3 7 11 9L25 7"/></svg><strong data-game-score>0 / ${TARGET}</strong></span>
          <span class="bird-game-hearts" data-game-hearts aria-label="剩余 3 颗心">♥ ♥ ♥</span>
          <div class="bird-game-controls">
            <button type="button" data-game-pause aria-label="暂停"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg></button>
            <button type="button" data-game-close aria-label="返回博客"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </div>
        </div>
        <div class="bird-game-overlay" hidden>
          <div class="bird-game-result" data-game-result></div>
          <button type="button" data-game-action aria-label="继续飞行"></button>
        </div>
      </div>
      <p class="bird-game-sr">最好成绩 <span data-game-best></span> 封</p>
      <p class="bird-game-sr" role="status" aria-live="polite" data-game-announcement></p>`;
    document.body.append(dialog);
    const canvas = dialog.querySelector('canvas');
    const context = canvas.getContext('2d');
    const stage = dialog.querySelector('.bird-game-stage');
    const overlay = dialog.querySelector('.bird-game-overlay');
    const resultLabel = dialog.querySelector('[data-game-result]');
    const action = dialog.querySelector('[data-game-action]');
    const pauseButton = dialog.querySelector('[data-game-pause]');
    const scoreLabel = dialog.querySelector('[data-game-score]');
    const heartsLabel = dialog.querySelector('[data-game-hearts]');
    const bestLabel = dialog.querySelector('[data-game-best]');
    const announcement = dialog.querySelector('[data-game-announcement]');
    const inertElements = [];
    let state = 'intro';
    let frame = 0;
    let previousTime = 0;
    let width = 960;
    let scale = 1;
    let dpr = 1;
    let clock = 0;
    let score = 0;
    let best = readBest();
    let hearts = 3;
    let birdY = 235;
    let velocity = 0;
    let protection = 2.8;
    let nextLetter = .9;
    let nextCloud = 1.6;
    let letters = [];
    let clouds = [];
    let sparks = [];
    let observer = null;

    session = { dialog, close: finishClose };
    document.body.style.overflow = 'hidden';
    const alreadyWorldActive = document.body.classList.contains('bird-world-active');
    document.body.classList.add('bird-world-active');
    try {
      if (typeof dialog.showModal !== 'function') throw new Error('No native dialog');
      dialog.showModal();
    } catch (_) {
      dialog.setAttribute('open', '');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.classList.add('bird-game-fallback');
      for (const element of document.body.children) {
        if (element === dialog) continue;
        inertElements.push([element, element.inert]);
        element.inert = true;
      }
    }

    function announce(text) { announcement.textContent = text; }

    function updateHud() {
      scoreLabel.textContent = `${score} / ${TARGET}`;
      heartsLabel.textContent = Array.from({ length: 3 }, (_, i) => i < hearts ? '♥' : '♡').join(' ');
      heartsLabel.setAttribute('aria-label', `剩余 ${hearts} 颗心`);
      bestLabel.textContent = String(best);
    }

    function showPanel(nextState) {
      state = nextState;
      dialog.dataset.birdGameState = state;
      overlay.hidden = false;
      canvas.tabIndex = -1;
      const paused = nextState === 'paused';
      const iconPath = paused ? 'M8 5v14M16 5v14' : nextState === 'won' ? 'm4 12 5 5L20 5' : 'm6 6 12 12M18 6 6 18';
      resultLabel.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${iconPath}"/></svg><span>${score} / ${TARGET}</span>`;
      resultLabel.setAttribute('aria-label', `${paused ? '已暂停' : nextState === 'won' ? '通关' : '旅程结束'}，收集 ${score} 封信件`);
      action.setAttribute('aria-label', paused ? '继续飞行' : '再飞一次');
      action.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paused ? 'm8 5 11 7-11 7Z' : 'M20 11a8 8 0 1 0-2 6M20 4v7h-7'}"/></svg>`;
      pauseButton.hidden = true;
      cancelAnimationFrame(frame);
      frame = 0;
      draw();
      action.focus({ preventScroll: true });
    }

    function begin() {
      if (!context) return;
      score = 0;
      hearts = 3;
      clock = 0;
      birdY = HEIGHT * .48;
      velocity = -155;
      protection = 2.8;
      nextLetter = .9;
      nextCloud = 1.6;
      letters = [{ x: width * .23 + flightSpeed() * 1.1, y: HEIGHT * .48, phase: 0 }];
      clouds = [];
      sparks = [];
      updateHud();
      resume();
      if (document.hidden) {
        state = 'playing';
        pause(true);
      }
    }

    function resume() {
      if (document.hidden) return;
      state = 'playing';
      dialog.dataset.birdGameState = state;
      overlay.hidden = true;
      canvas.tabIndex = 0;
      pauseButton.hidden = false;
      previousTime = 0;
      canvas.focus({ preventScroll: true });
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    }

    function pause(hidden = false) {
      if (state !== 'playing') return;
      showPanel('paused');
      announce('游戏已暂停。');
    }

    function finish(won) {
      if (score > best) {
        best = score;
        try { localStorage.setItem(STORAGE_KEY, String(best)); } catch (_) { /* Storage is optional. */ }
      }
      updateHud();
      showPanel(won ? 'won' : 'over');
      announce(won ? '通关！收集了 12 封信件。' : `旅程结束，收集了 ${score} 封信件。`);
    }

    function flap() {
      if (state !== 'playing') return;
      velocity = -205;
      if (!reduced) sparks.push({ x: width * .23 - 12, y: birdY + 8, life: .45, mail: false });
    }

    function hurt() {
      if (protection > 0) return;
      hearts -= 1;
      protection = 1.8;
      velocity = -170;
      updateHud();
      if (!hearts) finish(false);
      else announce(`撞到风雨了，还剩 ${hearts} 颗心。`);
    }

    function resize() {
      const box = stage.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const oldWidth = width;
      scale = box.height / HEIGHT;
      width = box.width / scale;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(box.width * dpr);
      canvas.height = Math.round(box.height * dpr);
      if (oldWidth !== width) {
        for (const item of [...letters, ...clouds, ...sparks]) item.x *= width / oldWidth;
      }
      draw();
    }

    function flightSpeed() {
      // Narrow screens retain at least one second to react to an approaching cloud.
      return Math.min(245 + score * 3.3, width * .66);
    }

    function update(dt) {
      clock += dt;
      protection = Math.max(0, protection - dt);
      velocity = Math.min(295, velocity + 330 * dt);
      birdY += velocity * dt;
      if (birdY < 32) { birdY = 32; velocity = Math.max(0, velocity); }
      if (birdY > HEIGHT - 72) {
        birdY = HEIGHT - 72;
        hurt();
        velocity = -170;
      }
      if (state !== 'playing') return;
      const speed = flightSpeed();
      if (clock >= nextLetter) {
        const y = 230 + Math.sin(clock * .55) * 65;
        letters.push({ x: Math.min(width + 34, width * .23 + speed * 1.5), y, phase: random(0, Math.PI * 2) });
        nextLetter = clock + .9;
      }
      if (clock >= nextCloud) {
        const routeY = 230 + Math.sin((clock + 1.4) * .55) * 65;
        const side = Math.random() < .5 ? -1 : 1;
        const y = clamp(routeY + side * random(80, 110), 80, HEIGHT - 115);
        clouds.push({ x: Math.min(width + 70, width * .23 + speed * 1.8), y, radius: random(25, 32) });
        nextCloud = clock + random(1.45, 1.75);
      }
      for (const letter of letters) {
        letter.x -= speed * dt;
        if (Math.hypot(letter.x - width * .23, letter.y - birdY) < 35) {
          letter.collected = true;
          score += 1;
          if (score > best) {
            best = score;
            try { localStorage.setItem(STORAGE_KEY, String(best)); } catch (_) { /* Storage is optional. */ }
          }
          if (!reduced) sparks.push({ x: letter.x, y: letter.y, life: .65, mail: true });
          updateHud();
          if (score >= TARGET) { finish(true); return; }
          announce(`收到第 ${score} 封信。`);
        }
      }
      for (const cloud of clouds) {
        cloud.x -= speed * dt;
        if (Math.hypot((cloud.x - width * .23) * .88, cloud.y - birdY) < cloud.radius + 13) hurt();
        if (state !== 'playing') return;
      }
      letters = letters.filter(item => !item.collected && item.x > -45);
      clouds = clouds.filter(item => item.x > -90);
      for (const spark of sparks) { spark.x -= speed * dt * .65; spark.life -= dt; }
      sparks = sparks.filter(item => item.life > 0);
    }

    function line(points, color, thickness = 1.6) {
      context.beginPath();
      points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
      context.strokeStyle = color;
      context.lineWidth = thickness;
      context.stroke();
    }

    function drawCloud(x, y, radius, storm) {
      context.save();
      context.translate(x, y);
      context.scale(radius / 34, radius / 34);
      context.beginPath();
      context.moveTo(-39, 18);
      context.bezierCurveTo(-58, 13, -52, -10, -31, -12);
      context.bezierCurveTo(-28, -37, 4, -39, 17, -19);
      context.bezierCurveTo(38, -27, 53, -6, 40, 8);
      context.bezierCurveTo(48, 22, 29, 27, 15, 24);
      context.closePath();
      context.fillStyle = storm ? '#8985a5' : '#fcfbf8';
      context.fill();
      context.strokeStyle = storm ? '#716c8d' : '#ddd9e8';
      context.lineWidth = 1.4;
      context.stroke();
      if (storm) {
        for (let i = -20; i <= 20; i += 20) line([[i, 34], [i - 5, 45]], '#9691b2', 2);
        line([[-19, 2], [-10, 1]], '#625d7c', 2);
        line([[8, 1], [17, 2]], '#625d7c', 2);
      }
      context.restore();
    }

    function drawBird(x, y) {
      context.save();
      context.translate(x, y);
      const tilt = state === 'playing' ? clamp(velocity / 700, -.2, .25) : -.06;
      context.rotate(tilt);
      context.scale(.9, .9);
      context.translate(-35, -31);
      context.fillStyle = '#29334c';
      context.fill(bodyPath);
      context.save();
      context.translate(29, 32);
      context.rotate(reduced || state !== 'playing' ? -.12 : Math.sin(clock * 12) * .22);
      context.translate(-29, -32);
      context.fillStyle = '#aaa2c9';
      context.fill(wingPath);
      context.restore();
      context.beginPath();
      context.arc(44.5, 22, 1.7, 0, Math.PI * 2);
      context.fillStyle = '#fcfbf8';
      context.fill();
      line([[32, 45], [28, 48], [23, 48]], '#29334c', 2.2);
      if (protection > 0 && state === 'playing') {
        context.beginPath();
        context.ellipse(34, 30, 38, 29, 0, 0, Math.PI * 2);
        context.strokeStyle = '#bdb5d8';
        context.lineWidth = 1.8;
        context.setLineDash([5, 5]);
        context.stroke();
      }
      context.restore();
    }

    function drawLetter(letter) {
      const bob = reduced ? 0 : Math.sin(clock * 2.5 + letter.phase) * 3;
      context.save();
      context.translate(letter.x, letter.y + bob);
      context.rotate(-.08);
      context.fillStyle = '#fcfbf8';
      context.strokeStyle = '#9487b3';
      context.lineWidth = 1.8;
      context.fillRect(-17, -12, 34, 24);
      context.strokeRect(-17, -12, 34, 24);
      line([[-17, -12], [0, 2], [17, -12]], '#9487b3');
      line([[-17, 12], [-6, 2]], '#c4bad8', 1.2);
      line([[17, 12], [6, 2]], '#c4bad8', 1.2);
      context.beginPath();
      context.arc(0, 2, 3, 0, Math.PI * 2);
      context.fillStyle = '#b8a0be';
      context.fill();
      context.restore();
    }

    function draw() {
      if (!context) return;
      context.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      context.clearRect(0, 0, width, HEIGHT);
      context.fillStyle = '#f5f3f9';
      context.fillRect(0, 0, width, HEIGHT);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      const drift = reduced ? 0 : clock * 37;
      for (let i = 0; i < Math.ceil(width / 250) + 1; i++) {
        const x = ((i * 250 + 100 - drift) % (width + 250) + width + 250) % (width + 250) - 80;
        drawCloud(x, 65 + (i % 3) * 58, 22 + (i % 2) * 9, false);
      }
      // A few deliberate ink lines suggest the riverbank, rather than a busy backdrop.
      const riverY = HEIGHT - 56;
      context.fillStyle = '#e8e7f0';
      context.fillRect(0, riverY, width, HEIGHT - riverY);
      line([[0, riverY], [width, riverY]], '#c6c4d6', 1.5);
      for (let i = 0; i < Math.ceil(width / 160) + 1; i++) {
        const x = i * 160 - (reduced ? 0 : clock * 75 % 160);
        line([[x, riverY + 21], [x + 34, riverY + 20], [x + 55, riverY + 22]], '#c2c0d4', 1.4);
        line([[x + 73, riverY + 40], [x + 112, riverY + 39]], '#d0cddd', 1.2);
      }
      if (!reduced) {
        for (let i = 0; i < 6; i++) {
          const span = width + 110;
          const x = ((i * 193 - clock * 160) % span + span) % span - 55;
          const y = 110 + (i * 71) % 265;
          line([[x, y], [x + 28 + (i % 3) * 9, y - 1]], '#e2deec', 1.4);
        }
      }
      for (const cloud of clouds) drawCloud(cloud.x, cloud.y, cloud.radius, true);
      for (const letter of letters) if (!letter.collected) drawLetter(letter);
      for (const spark of sparks) {
        context.save();
        context.globalAlpha = clamp(spark.life * 2, 0, 1);
        if (spark.mail) {
          const r = (1 - spark.life) * 25;
          for (let i = 0; i < 5; i++) {
            const angle = i * Math.PI * 2 / 5;
            const x = spark.x + Math.cos(angle) * r;
            const y = spark.y + Math.sin(angle) * r;
            line([[x - 3, y], [x + 3, y]], '#a294bc', 1.5);
            line([[x, y - 3], [x, y + 3]], '#a294bc', 1.5);
          }
        } else line([[spark.x - 8, spark.y], [spark.x + 4, spark.y - 3]], '#b1a8c9', 1.8);
        context.restore();
      }
      drawBird(width * .23, birdY);
    }

    function tick(time) {
      if (state !== 'playing') return;
      const dt = previousTime ? Math.min((time - previousTime) / 1000, .04) : 0;
      previousTime = time;
      update(dt);
      draw();
      if (state === 'playing') frame = requestAnimationFrame(tick);
    }

    function finishClose() {
      if (!session || session.dialog !== dialog) return;
      session = null;
      cancelAnimationFrame(frame);
      controller.abort();
      observer?.disconnect();
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      dialog.remove();
      for (const [element, wasInert] of inertElements) element.inert = wasInert;
      document.body.style.overflow = previousOverflow;
      if (!alreadyWorldActive) document.body.classList.remove('bird-world-active');
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
      if (typeof options.onClose === 'function') options.onClose();
    }

    listen(dialog.querySelector('[data-game-close]'), 'click', finishClose);
    listen(action, 'click', () => !context ? finishClose() : state === 'paused' ? resume() : begin());
    listen(pauseButton, 'click', () => pause());
    listen(canvas, 'pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      flap();
    });
    listen(dialog, 'cancel', event => { event.preventDefault(); finishClose(); });
    listen(dialog, 'close', finishClose);
    listen(document, 'visibilitychange', () => { if (document.hidden) pause(true); });
    listen(document, 'keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); finishClose(); return; }
      // Native button keyboard behavior and any editable field retain their keys.
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
      if ((event.code === 'Space' || event.key === 'ArrowUp') && state === 'playing') {
        event.preventDefault();
        if (!event.repeat) flap();
      } else if (event.code === 'KeyP' && state === 'playing') {
        event.preventDefault();
        pause();
      }
    });
    // The native dialog traps focus. Supply the same behavior for its fallback.
    listen(dialog, 'keydown', event => {
      if (event.key !== 'Tab' || !dialog.classList.contains('bird-game-fallback')) return;
      const controls = [...dialog.querySelectorAll('button, [tabindex="0"]')].filter(element => element.getClientRects().length && !element.disabled);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(resize);
      observer.observe(stage);
    } else listen(window, 'resize', resize);
    updateHud();
    resize();
    if (context) begin();
    else finishClose();
  }

  window.KamomeGame = Object.freeze({
    open,
    close: () => session?.close(),
    isOpen: () => Boolean(session)
  });
})();
