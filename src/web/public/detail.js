// Post detail: tabs by hash (#editar, #planificar...), New/Side by side/Original
// view picker and live preview while editing.
// Without JS the page still works: all sections are shown one after another.
(function () {
  const panels = Array.from(document.querySelectorAll('[data-tab-panel]'));
  if (panels.length === 0) return;
  document.body.classList.add('has-tabs');

  function showTab(id) {
    const target = panels.find((p) => p.id === id) || panels[0];
    panels.forEach((p) => p.classList.toggle('is-active', p === target));
    document.querySelectorAll('.tab[data-tab-link]').forEach((a) => {
      const active = a.getAttribute('data-tab-link') === target.id;
      a.classList.toggle('is-active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  showTab(location.hash.slice(1));

  // New / Side by side / Original (remembered across visits)
  const grid = document.querySelector('[data-view-target]');
  const viewButtons = document.querySelectorAll('[data-view]');
  function setView(view) {
    if (!grid) return;
    grid.setAttribute('data-view-target', view);
    viewButtons.forEach((b) => {
      const active = b.getAttribute('data-view') === view;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    try { localStorage.setItem('gc-preview-view', view); } catch (e) { /* storage unavailable */ }
  }
  viewButtons.forEach((b) => b.addEventListener('click', () => setView(b.getAttribute('data-view'))));
  try {
    const saved = localStorage.getItem('gc-preview-view');
    if (saved) setView(saved);
  } catch (e) { /* storage unavailable */ }

  // Editor: live preview (debounced) + warning if you leave without saving
  const form = document.querySelector('[data-edit-form]');
  if (!form) return;
  const input = form.querySelector('[data-markdown-input]');
  const preview = form.querySelector('[data-edit-preview]');
  const status = form.querySelector('[data-edit-status]');
  const quality = form.querySelector('[data-edit-quality]');
  function field(name) {
    const el = form.querySelector('[name="' + name + '"]');
    return el ? el.value : undefined;
  }
  let dirty = false;
  let timer = null;
  let seq = 0;

  function countWords(text) {
    return text.split(/\s+/).filter(Boolean).length;
  }

  async function refreshPreview() {
    const mine = ++seq;
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown: input.value,
          title: field('title'),
          metaTitle: field('meta_title'),
          metaDescription: field('meta_description'),
          keyword: (form.querySelector('[data-q-keyword]') || {}).value || '',
          hasImage: !!(form.querySelector('[data-q-image]') || {}).value,
        }),
      });
      const data = await res.json();
      if (mine !== seq) return;
      preview.innerHTML = data.html; // HTML already sanitized on the server
      if (quality) quality.innerHTML = data.quality;
    } catch (e) {
      // transient failure: the next keystroke retries
    }
  }

  function markDirty() {
    dirty = true;
    if (status) status.textContent = window.gcT('post.edit.unsaved', { count: countWords(input.value) });
  }

  form.addEventListener('input', markDirty);
  // Any field (title, meta...) changes the quality score, not just the body.
  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(refreshPreview, 350);
  });
  form.addEventListener('submit', () => { dirty = false; });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && form.closest('.tab-panel').classList.contains('is-active')) {
      e.preventDefault();
      dirty = false;
      form.requestSubmit();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });
})();

// Block-by-block review: accept/reject all and live summary
(function () {
  const form = document.querySelector('[data-review-form]');
  if (!form) return;
  const summary = form.querySelector('[data-review-summary]');
  function update() {
    const radios = Array.from(form.querySelectorAll('input[type=radio][value=old]'));
    const rejected = radios.filter((r) => r.checked).length;
    if (summary) summary.textContent = window.gcT('review.summary', { accepted: radios.length - rejected, rejected });
  }
  form.querySelectorAll('[data-review-all]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.getAttribute('data-review-all');
      form.querySelectorAll('input[type=radio][value=' + value + ']').forEach((r) => { r.checked = true; });
      update();
    });
  });
  form.addEventListener('change', update);
  update();
})();


// Pending: the textarea grows with the text and shows how many questions are answered.
document.querySelectorAll('textarea[data-autogrow]').forEach((ta) => {
  const grow = () => {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
  };
  ta.addEventListener('input', grow);
  if (ta.value) requestAnimationFrame(grow);
});

(() => {
  const list = document.querySelector('[data-pending-list]');
  if (!list) return;
  const total = Number(list.dataset.total);
  const progress = document.querySelector('[data-pending-progress] strong');
  const bar = document.querySelector('[data-pending-bar]');
  const update = () => {
    let answered = 0;
    list.querySelectorAll('[data-pending-item]').forEach((item) => {
      const ta = item.querySelector('textarea');
      const value = ta.value.trim();
      const done = value.length > 0;
      if (done) answered++;
      item.classList.toggle('is-answered', done);
      const hasLink = /https?:\/\/\S+/.test(value);
      item.querySelector('[data-pending-state]').textContent = window.gcT(!done ? 'post.pending.unanswered' : hasLink ? 'post.pending.answeredLinks' : 'post.pending.answered');
    });
    if (progress) progress.textContent = String(answered);
    if (bar) bar.style.width = `${(answered / total) * 100}%`;
  };
  list.querySelectorAll('textarea[data-autogrow]').forEach((ta) => {
    ta.addEventListener('input', update);
  });
  update();
})();

// New post: how many links will be read.
document.querySelectorAll('textarea[data-url-count]').forEach((ta) => {
  const out = ta.parentElement.querySelector('[data-url-count-out]');
  const update = () => {
    const n = new Set(ta.value.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []).size;
    out.textContent = n === 0 ? '' : n > 6 ? window.gcT('post.urls.max', { count: 6 }) : window.gcT('post.urls.count', { count: n });
  };
  ta.addEventListener('input', update);
  update();
});

// Who else has this post open: a heartbeat every minute while the tab is visible.
(function () {
  const box = document.querySelector('[data-presence]');
  if (!box) return;
  const id = box.getAttribute('data-presence');
  async function beat() {
    if (document.visibilityState !== 'visible') return;
    try {
      const res = await fetch('/api/posts/' + encodeURIComponent(id) + '/presence', { method: 'POST', headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      if (box.innerHTML !== data.html) box.innerHTML = data.html;
    } catch (e) {
      /* offline: try again next minute */
    }
  }
  setInterval(beat, 60000);
  document.addEventListener('visibilitychange', beat);
})();
