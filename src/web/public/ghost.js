// Little ghost that occasionally crosses the bottom edge of the screen.
// Meant to be unobtrusive: it doesn't capture clicks (pointer-events: none),
// screen readers ignore it (aria-hidden), it doesn't appear while typing or
// with a dialog open, respects "reduce motion" and can be turned off from the
// palette (Cmd+K -> "Fantasma"). It appears:
// - after 2 minutes without touching the page, at most once every 10 minutes;
// - when the job you were watching finishes (jobs.js leaves a marker before
//   reloading the page).
(function () {
  const IDLE_MS = 2 * 60 * 1000;
  const MIN_GAP_MS = 10 * 60 * 1000;
  const PREF_KEY = 'gc-ghost';
  const LAST_KEY = 'gc-ghost-last';
  const NEXT_KEY = 'gc-ghost-next';

  const store = {
    get(k, s = localStorage) { try { return s.getItem(k); } catch (e) { return null; } },
    set(k, v, s = localStorage) { try { s.setItem(k, v); } catch (e) { /* no storage: no problem */ } },
    del(k, s = localStorage) { try { s.removeItem(k); } catch (e) { /* same */ } },
  };

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const enabled = () => store.get(PREF_KEY) !== 'off';
  const busy = () => {
    const el = document.activeElement;
    return !!(el && (el.matches('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')));
  };

  // Same drawing as the logo (8x9 block grid), without the background field.
  // The brand's red bit trails behind it (on the left; when moving
  // left the whole sprite is flipped).
  const SPRITE = '<svg viewBox="-18 0 58 45" width="40" height="32" shape-rendering="crispEdges" aria-hidden="true" focusable="false">'
    + '<rect class="gc-ghost-bit" x="-16" y="32" width="10" height="10" fill="#ff3e3e"/>'
    + '<path fill="var(--gc-ghost-body)" d="M10 0H30V5H35V10H40V45H30V40H25V45H15V40H10V45H0V10H5V5H10Z"/>'
    + '<g class="gc-ghost-eyes" fill="var(--gc-ghost-eyes)"><rect x="5" y="15" width="10" height="10"/><rect x="25" y="15" width="10" height="10"/></g>'
    + '</svg>';

  let showing = false;
  function show(force) {
    if (showing || !enabled() || reducedMotion() || document.hidden) return;
    if (!force && busy()) return;
    showing = true;
    store.set(LAST_KEY, String(Date.now()));

    const el = document.createElement('div');
    el.className = 'gc-ghost';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = SPRITE;
    // Goes the opposite way half the time (facing where it's heading).
    const ltr = Math.random() < 0.5;
    if (!ltr) el.style.transform = 'scaleX(-1)';
    document.body.appendChild(el);

    const width = window.innerWidth + 80;
    const travel = el.animate(
      [{ translate: ltr ? '-60px 0' : `${width}px 0` }, { translate: ltr ? `${width}px 0` : '-60px 0' }],
      { duration: 9000, easing: 'linear' },
    );
    // Bobbing in "pixel" jumps, like the logo.
    el.firstElementChild.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-6px)' }], {
      duration: 900, iterations: Infinity, direction: 'alternate', easing: 'steps(3, jump-none)',
    });
    travel.finished.finally(() => { el.remove(); showing = false; });
  }

  // Inactivity: any interaction resets the count.
  let timer = null;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const last = Number(store.get(LAST_KEY) || 0);
      if (Date.now() - last >= MIN_GAP_MS) show(false);
      arm();
    }, IDLE_MS);
  };
  ['pointermove', 'pointerdown', 'keydown', 'scroll', 'input'].forEach((ev) => window.addEventListener(ev, arm, { passive: true }));
  arm();

  // A job finished right before reloading: discreet celebration.
  if (store.get(NEXT_KEY, sessionStorage)) {
    store.del(NEXT_KEY, sessionStorage);
    setTimeout(() => show(true), 600);
  }

  window.gcGhost = {
    show: () => show(true),
    enabled,
    toggle() {
      if (enabled()) store.set(PREF_KEY, 'off'); else store.del(PREF_KEY);
      return enabled();
    },
    /** Called by jobs.js before reloading when a job finishes. */
    queueAfterReload() { store.set(NEXT_KEY, '1', sessionStorage); },
  };
})();
