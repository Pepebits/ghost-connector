// Dashboard: the batch actions bar only appears when something is selected.
(function () {
  const form = document.querySelector('[data-batch-form]');
  if (!form) return;
  const bar = form.querySelector('[data-batch-bar]');
  const count = form.querySelector('[data-batch-count]');
  const all = form.querySelector('.select-all');
  const rows = () => Array.from(form.querySelectorAll('.row-check'));

  function update() {
    const n = rows().filter((cb) => cb.checked).length;
    bar.hidden = n === 0;
    count.textContent = window.gcT('dashboard.batch.selected', { count: n });
    if (all) all.checked = n > 0 && n === rows().length;
  }

  if (all) all.addEventListener('change', () => { rows().forEach((cb) => { cb.checked = all.checked; }); update(); });
  form.addEventListener('change', (e) => { if (e.target.classList.contains('row-check')) update(); });
  update();
})();

// Keyboard navigation in the list: j/k move, Enter open, x toggle.
(function () {
  const rows = () => Array.from(document.querySelectorAll('[data-post-row]'));
  let current = -1;

  function isTyping(e) {
    const t = e.target;
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  function select(i) {
    const list = rows();
    if (list.length === 0) return;
    current = Math.max(0, Math.min(i, list.length - 1));
    list.forEach((r, idx) => r.classList.toggle('is-current', idx === current));
    const row = list[current];
    row.scrollIntoView({ block: 'nearest' });
    document.dispatchEvent(new CustomEvent('gc:row-selected', { detail: { postId: row.getAttribute('data-post-row') } }));
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'j') { e.preventDefault(); select(current + 1); }
    else if (e.key === 'k') { e.preventDefault(); select(current - 1); }
    else if (current >= 0 && e.key === 'Enter') {
      const link = rows()[current].querySelector('a[href^="/posts/"]');
      if (link) { e.preventDefault(); link.click(); }
    } else if (current >= 0 && e.key === 'x') {
      const cb = rows()[current].querySelector('.row-check');
      if (cb) { e.preventDefault(); cb.click(); }
    }
  });

  window.gcSelectRow = (postId) => select(rows().findIndex((r) => r.getAttribute('data-post-row') === postId));
})();

// Side panel: clicking a row (or j/k) loads its summary without leaving the list.
(function () {
  const panel = document.querySelector('[data-peek]');
  if (!panel) return;
  const wide = window.matchMedia('(min-width: 1280px)'); // same breakpoint as xl: in the CSS
  let seq = 0;

  async function load(postId) {
    if (!wide.matches) return; // on narrow screens the panel isn't visible: don't fetch
    const mine = ++seq;
    try {
      const res = await fetch('/posts/' + encodeURIComponent(postId) + '/peek');
      const htmlText = await res.text();
      if (mine === seq) panel.innerHTML = htmlText; // fragment generated (and escaped) on the server
    } catch (e) {
      // transient failure: retried on the next selection
    }
  }

  const placeholder = panel.innerHTML; // same text on close as on load
  document.addEventListener('gc:row-selected', (e) => load(e.detail.postId));
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-peek-close]')) {
      panel.innerHTML = placeholder;
    }
  });

  // Click on the row (outside the link and checkbox) = select it.
  document.addEventListener('click', (e) => {
    const row = e.target.closest('[data-post-row]');
    if (!row || e.target.closest('a, input, button, label')) return;
    if (window.gcSelectRow) window.gcSelectRow(row.getAttribute('data-post-row'));
  });
})();
