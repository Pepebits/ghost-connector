// Settings: one form per section. "Test connection" sends that section's
// fields (unsaved) to the server, which tests them over the saved config and
// uses the saved secret if the field is empty. No secret is ever sent back.
// The unsaved-changes warning comes from ui.js (form[data-guard]).
document.querySelectorAll('form[data-env-form]').forEach((form) => {
  // Changes made by buttons (order, filter mode) count as edits too.
  const touched = () => form.dispatchEvent(new Event('input', { bubbles: true }));

  form.querySelectorAll('[data-test-connection]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const service = btn.getAttribute('data-test-connection');
      const out = form.querySelector('[data-test-result="' + service + '"]');
      btn.disabled = true;
      out.className = '!mb-0 mt-2 text-sm empty:hidden text-muted';
      out.textContent = gcT('settings.form.testing');
      try {
        const res = await fetch('/api/settings/test/' + service, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(new FormData(form)),
        });
        const data = await res.json();
        out.className = '!mb-0 mt-2 text-sm empty:hidden ' + (data.ok ? 'text-ok' : 'text-err');
        out.textContent = (data.ok ? '✓ ' : '✗ ') + data.message + (data.ms !== undefined ? ' (' + data.ms + ' ms)' : '');
      } catch (e) {
        out.className = '!mb-0 mt-2 text-sm empty:hidden text-err';
        out.textContent = '✗ ' + gcT('settings.form.unreachable');
      } finally {
        btn.disabled = false;
      }
    });
  });

  // Image source order: up/down buttons, focus follows the moved item.
  form.querySelectorAll('[data-order-field]').forEach((field) => {
    const list = field.querySelector('ol');
    const hidden = field.querySelector('[data-order-value]');
    const status = field.querySelector('[data-order-status]');
    const sync = () => {
      const items = Array.from(list.querySelectorAll('[data-order-item]'));
      items.forEach((li, i) => {
        li.querySelector('[data-order-pos]').textContent = i + 1 + '.';
        li.querySelector('[data-order-move="-1"]').disabled = i === 0;
        li.querySelector('[data-order-move="1"]').disabled = i === items.length - 1;
      });
      hidden.value = items.map((li) => li.getAttribute('data-order-item')).join(',');
    };
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-order-move]');
      if (!btn) return;
      const li = btn.closest('[data-order-item]');
      const dir = Number(btn.getAttribute('data-order-move'));
      const sibling = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
      if (!sibling) return;
      if (dir < 0) list.insertBefore(li, sibling); else list.insertBefore(sibling, li);
      sync();
      const again = li.querySelector('[data-order-move="' + dir + '"]');
      (again && !again.disabled ? again : li.querySelector('[data-order-move="' + -dir + '"]')).focus();
      const pos = Array.from(list.children).indexOf(li) + 1;
      status.textContent = gcT('settings.order.position', { name: li.getAttribute('data-order-label'), pos: pos });
      touched();
    });
    sync();
  });

  // Drafts filter: the picker and the tag build the NQL (same
  // format as src/ghost/draftFilter.ts); in "advanced" it's edited by hand.
  form.querySelectorAll('[data-draft-filter]').forEach((box) => {
    const mode = box.querySelector('[data-df-mode]');
    const tagWrap = box.querySelector('[data-df-tag-wrap]');
    const tag = box.querySelector('[data-df-tag]');
    const nql = box.querySelector('[data-df-nql]');
    const list = box.querySelector('[data-df-tags]');
    let custom = mode.value === 'custom' ? nql.value : '';
    const build = () => {
      const m = mode.value;
      tagWrap.hidden = !(m === 'tag' || m === 'not-tag');
      nql.readOnly = m !== 'custom';
      const slug = tag.value.trim().toLowerCase();
      if (m === 'all') nql.value = 'status:draft';
      else if (m === 'tag' || m === 'not-tag') nql.value = /^[a-z0-9][a-z0-9-]*$/.test(slug) ? 'status:draft+tag:' + (m === 'not-tag' ? '-' : '') + slug : 'status:draft';
      else nql.value = custom || nql.value;
    };
    mode.addEventListener('change', () => { build(); touched(); if (mode.value === 'custom') nql.focus(); });
    tag.addEventListener('input', build);
    nql.addEventListener('input', () => { if (mode.value === 'custom') custom = nql.value; });
    nql.readOnly = mode.value !== 'custom';

    // Real Ghost tags for autocomplete (fetched once, on focus).
    let loaded = false;
    tag.addEventListener('focus', async () => {
      if (loaded) return;
      loaded = true;
      try {
        const res = await fetch('/api/settings/ghost-tags');
        if (!res.ok) return;
        const data = await res.json();
        list.replaceChildren(...data.tags.map((t) => {
          const o = document.createElement('option');
          o.value = t.slug;
          o.label = t.name + (t.internal ? ' (' + gcT('settings.draftFilter.internal') + ')' : '');
          return o;
        }));
      } catch (e) { /* no autocomplete: the slug can still be typed */ }
    });
  });
});

// Model pickers (AI section): the list comes from the provider (GET /models
// through the server, with the form's provider/URL/key). "Other…" shows a box
// to type any name. If the list can't be loaded, typing is the fallback.
document.querySelectorAll('form[data-env-form]').forEach((form) => {
  const selects = Array.from(form.querySelectorAll('[data-model-select]'));
  if (selects.length === 0) return;
  const status = form.querySelector('[data-model-status]');
  const custom = (sel) => sel.parentElement.querySelector('[data-model-custom]');
  selects.forEach((sel) => {
    const box = custom(sel);
    const toggle = () => { box.hidden = sel.value !== '__other'; if (!box.hidden) box.focus(); };
    sel.addEventListener('change', toggle);
  });
  let seq = 0;
  async function load() {
    const mine = ++seq;
    if (status) status.textContent = gcT('settings.model.loading');
    let data;
    try {
      const res = await fetch('/api/settings/ai-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)),
      });
      data = await res.json();
    } catch (e) {
      data = { ok: false, models: [], message: gcT('settings.form.unreachable') };
    }
    if (mine !== seq) return;
    selects.forEach((sel) => {
      const keep = sel.value;
      // Rebuild: the fixed first option ("same as main", if any), the models, and "Other…".
      sel.querySelectorAll('option[data-listed]').forEach((o) => o.remove());
      const other = sel.querySelector('option[value="__other"]');
      const existing = new Set(Array.from(sel.options).map((o) => o.value));
      data.models.forEach((id) => {
        if (existing.has(id)) return;
        const o = document.createElement('option');
        o.value = id; o.textContent = id; o.dataset.listed = '';
        sel.insertBefore(o, other);
      });
      sel.value = keep;
    });
    if (status) status.textContent = data.ok ? gcT('settings.model.loaded', { count: data.models.length }) : gcT('settings.model.failed', { message: data.message || '?' });
  }
  ['AI_PROVIDER', 'AI_BASE_URL', 'AI_API_KEY'].forEach((name) => {
    const el = form.elements.namedItem(name);
    if (el) el.addEventListener('change', load);
  });
  load();
});

// "Get an API key" link of the AI section follows the provider picker.
document.querySelectorAll('[data-ai-key-link]').forEach((a) => {
  const urls = JSON.parse(a.getAttribute('data-ai-key-link'));
  const sel = a.closest('form').elements.namedItem('AI_PROVIDER');
  if (!sel) return;
  const sync = () => { const u = urls[sel.value]; a.hidden = !u; if (u) a.href = u; };
  sel.addEventListener('change', sync);
});

// Ghost key link: follows the site URL as you type it (only valid http(s) URLs).
document.querySelectorAll('[data-ghost-key-link]').forEach((a) => {
  const input = a.closest('form').elements.namedItem('GHOST_API_URL');
  if (!input) return;
  const sync = () => {
    let u = null;
    try { u = new URL(input.value.trim()); } catch (e) { /* incomplete URL */ }
    const ok = u && /^https?:$/.test(u.protocol) && u.hostname.includes('.') || (u && u.hostname === 'localhost');
    a.hidden = !ok;
    if (ok) a.href = u.origin + u.pathname.replace(/\/+$/, '') + '/ghost/#/settings/integrations';
  };
  input.addEventListener('input', sync);
});

// Section nav: marks the section you clicked, or the one you scroll to
// (the topmost section whose title has passed the upper third of the screen).
(function () {
  const links = Array.from(document.querySelectorAll('.settings-nav a[href^="#"]'));
  if (links.length === 0) return;
  const sections = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  const mark = (id) => links.forEach((a) => {
    if (a.getAttribute('href') === '#' + id) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
  // After a click the clicked section stays marked until the user scrolls by
  // hand (sections near the bottom can't reach the line on their own).
  let clicked = null;
  links.forEach((a) => a.addEventListener('click', () => {
    clicked = a.getAttribute('href').slice(1);
    mark(clicked);
  }));
  const release = () => { clicked = null; };
  ['wheel', 'touchmove', 'keydown'].forEach((ev) => window.addEventListener(ev, release, { passive: true }));
  const update = () => {
    if (clicked) return;
    const line = window.innerHeight / 3;
    let current = sections[0];
    for (const s of sections) if (s.getBoundingClientRect().top <= line) current = s;
    // At the very bottom the last sections can't reach the line: pick the last one.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = sections[sections.length - 1];
    mark(current.id);
  };
  window.addEventListener('scroll', update, { passive: true });
  if (location.hash && document.getElementById(location.hash.slice(1))) clicked = location.hash.slice(1);
  mark(clicked || sections[0].id);
  if (!clicked) update();
})();

// Import: the file goes as the raw body (no multipart), then on to the preview.
(function () {
  const form = document.querySelector('[data-import-form]');
  if (!form) return;
  const error = form.querySelector('[data-import-error]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = form.querySelector('input[type=file]').files[0];
    if (!file) return;
    const button = form.querySelector('button[type=submit]');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = form.getAttribute('data-import-busy') || label;
    error.textContent = '';
    try {
      const res = await fetch(form.action, { method: 'POST', headers: { 'content-type': 'application/octet-stream', accept: 'text/plain' }, body: file });
      if (res.redirected) {
        location.href = res.url;
        return;
      }
      error.textContent = await res.text();
    } catch (err) {
      error.textContent = String(err);
    }
    button.disabled = false;
    button.textContent = label;
  });
})();
