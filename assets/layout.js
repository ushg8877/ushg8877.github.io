/* Native details keeps the history usable with keyboard and without scripts. */
(() => {
  const panel = document.querySelector('#updates-panel');
  if (!panel) return;
  const sidebar = document.querySelector('#updates-sidebar');
  const layout = sidebar.parentElement;
  const narrow = matchMedia('(max-width:880px)');
  const updateSticky = () => {
    const top = parseFloat(getComputedStyle(sidebar).top) || 0;
    sidebar.dataset.sticky = String(!narrow.matches && sidebar.scrollHeight <= innerHeight - top * 2);
  };
  const adapt = () => {
    const focused = sidebar.contains(document.activeElement) ? document.activeElement : null;
    if (narrow.matches) layout.prepend(sidebar);
    else layout.append(sidebar);
    panel.open = !narrow.matches || Boolean(focused);
    if (focused) focused.focus({preventScroll:true});
    updateSticky();
  };
  adapt();
  narrow.addEventListener('change', adapt);
  window.addEventListener('resize', updateSticky);
  panel.addEventListener('toggle', updateSticky);
  if ('ResizeObserver' in window) new ResizeObserver(updateSticky).observe(sidebar);
})();
