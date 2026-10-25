// Behavior shared by all pages (loaded by layout.ts):
// - [data-open-dialog="id"] opens a modal <dialog>; [data-close-dialog] closes it.
//   A click outside does NOT close it (when selecting text the mouse may be released outside).
// - form[data-busy="Text…"]: on submit, disables the button and explains the wait.
// - form[data-guard]: warns before leaving the page with unsaved changes.
// - window.gcT('key', { vars }): translated strings (the same keys as t() on the server,
//   which layout.ts puts in window.GC_I18N).
(function () {
  const i18n = window.GC_I18N || { locale: 'en', messages: {} };
  const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? (typeof vars[k] === 'number' ? vars[k].toLocaleString(i18n.locale) : vars[k]) : m));
  window.gcLocale = i18n.locale;
  window.gcT = (key, vars) => {
    let node = i18n.messages;
    for (const part of key.split('.')) node = node && typeof node === 'object' ? node[part] : undefined;
    if (node && typeof node === 'object' && vars && typeof vars.count === 'number') node = node[new Intl.PluralRules(i18n.locale).select(vars.count)] ?? node.other;
    return typeof node === 'string' ? fill(node, vars) : key;
  };

  document.querySelectorAll('[data-open-dialog]').forEach((btn) => {
    const dialog = document.getElementById(btn.getAttribute('data-open-dialog'));
    if (!dialog) return;
    btn.addEventListener('click', (e) => { e.preventDefault(); dialog.showModal(); });
  });
  document.querySelectorAll('dialog [data-close-dialog]').forEach((b) => {
    b.addEventListener('click', () => b.closest('dialog').close());
  });

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    // The button may be outside the form (form= attribute, batch dialogs).
    const button = e.submitter || form.querySelector('button[type="submit"]');
    const busy = form.dataset.busy || (button && button.dataset.busy);
    if (!busy || !button) return;
    // Disabled after the browser collects the button's name/value.
    setTimeout(() => {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      if (button.classList.contains('image-option')) {
        // Image buttons keep their thumbnail (and size): spinner on top, the rest dimmed.
        form.querySelectorAll('.image-option').forEach((b) => { if (b !== button) b.disabled = true; });
        form.classList.add('is-picking');
        const overlay = document.createElement('span');
        overlay.className = 'busy-overlay';
        overlay.setAttribute('role', 'status');
        overlay.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
        overlay.append(busy);
        button.prepend(overlay);
        return;
      }
      button.textContent = busy;
    }, 0);
  });

  let dirty = false;
  document.querySelectorAll('form[data-guard]').forEach((form) => {
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('submit', () => { dirty = false; });
  });
  window.gcMarkClean = () => { dirty = false; };
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // Boxes that scroll (previews, wide tables, diffs) must be reachable
  // by keyboard to scroll them; only those that actually overflow.
  const makeScrollablesFocusable = () => {
    document.querySelectorAll('.article-preview, .overflow-x-auto, pre').forEach((el) => {
      const overflows = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
      // With links or buttons inside, Tab already scrolls it into view.
      const hasFocusable = el.querySelector('a[href], button, input, select, textarea, [tabindex]');
      if (overflows && !hasFocusable && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    });
  };
  makeScrollablesFocusable();
  // Tabs and <details> reveal hidden boxes: check again when they open.
  window.addEventListener('hashchange', () => setTimeout(makeScrollablesFocusable, 0));
  document.addEventListener('toggle', makeScrollablesFocusable, true);
})();

// Dropdown menus (<details data-menu>: the header user menu, each user's actions):
// one open at a time; they close on Escape, a click outside, or once an item is chosen.
(function () {
  const menus = () => Array.from(document.querySelectorAll('details[data-menu]'));
  document.addEventListener('toggle', (e) => {
    if (e.target.matches && e.target.matches('details[data-menu]') && e.target.open) menus().forEach((m) => { if (m !== e.target) m.open = false; });
  }, true);
  document.addEventListener('click', (e) => {
    menus().forEach((m) => {
      if (!m.open) return;
      if (!m.contains(e.target)) m.open = false;
      else if (e.target.closest('.user-menu-panel button, .user-menu-panel a')) m.open = false;
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = menus().find((m) => m.open);
    if (open) {
      open.open = false;
      open.querySelector('summary').focus();
    }
  });
})();

// Read-only fields to copy (invite links): select everything on focus.
document.addEventListener('focusin', (e) => {
  if (e.target.matches && e.target.matches('[data-select-on-focus]')) e.target.select();
});

// Recovery codes: copy or download them all at once, one per line.
(function () {
  const box = document.querySelector('[data-recovery-codes]');
  if (!box) return;
  const T = (k) => (window.gcT ? window.gcT(k) : k);
  const codes = () => Array.from(box.querySelectorAll('li')).map((li) => li.textContent.trim()).join('\n') + '\n';
  const status = box.querySelector('[data-copy-status]');
  box.querySelector('[data-recovery-actions]').hidden = false;

  box.querySelector('[data-copy-codes]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codes());
      status.textContent = T('auth.recovery.copied');
    } catch (e) {
      // No clipboard access (old browser, plain http): select the list so Cmd/Ctrl+C works.
      const range = document.createRange();
      range.selectNodeContents(box.querySelector('ul'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      status.textContent = T('auth.recovery.copyFailed');
    }
  });

  box.querySelector('[data-download-codes]').addEventListener('click', (e) => {
    const url = URL.createObjectURL(new Blob([codes()], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = e.currentTarget.getAttribute('data-filename');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();

// Table rows that unfold a detail row below (Settings → Costs per user).
document.addEventListener('click', (e) => {
  const btn = e.target instanceof Element ? e.target.closest('[data-toggle-row]') : null;
  if (!btn) return;
  const row = document.getElementById(btn.getAttribute('aria-controls') || '');
  if (!row) return;
  const open = row.hidden;
  row.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  const icon = btn.querySelector('[data-toggle-icon]');
  if (icon) icon.textContent = open ? '▾' : '▸';
});

// Author pickers: the "primary" radio only for checked authors; checking the first one makes it primary.
document.addEventListener('change', (e) => {
  const box = e.target instanceof HTMLInputElement && e.target.matches('[data-author-check]') ? e.target : null;
  if (!box) return;
  const picker = box.closest('[data-author-picker]');
  const radio = box.closest('li')?.querySelector('[data-author-primary]');
  if (!picker || !(radio instanceof HTMLInputElement)) return;
  radio.disabled = !box.checked;
  if (!box.checked && radio.checked) radio.checked = false;
  const radios = [...picker.querySelectorAll('[data-author-primary]')].filter((r) => r instanceof HTMLInputElement && !r.disabled);
  if (!radios.some((r) => r.checked) && radios[0]) radios[0].checked = true;
});
