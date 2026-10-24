// Command palette (Cmd/Ctrl+K) and single-key shortcuts, on every page.
// - Global commands + the current page's: any element with
//   data-palette="Text" shows up in the palette (and is "clicked" when chosen).
// - data-shortcut="e" on an element activates it with that key.
// - Shortcuts don't fire while typing in a field.
(function () {
  function isTyping(e) {
    const t = e.target;
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  function postForm(action) {
    const f = document.createElement('form');
    f.method = 'post';
    f.action = action;
    document.body.appendChild(f);
    f.submit();
  }

  const T = (k, v) => (window.gcT ? window.gcT(k, v) : k);

  const isEditor = () => document.body.dataset.role === 'editor';
  const GLOBAL = [
    { get label() { return T('palette.cmd.goDrafts'); }, hint: 'g d', run: () => { location.href = '/'; } },
    { get label() { return T('palette.cmd.goJobs'); }, hint: 'g j', run: () => { location.href = '/jobs'; } },
    { get label() { return T('palette.cmd.goSettings'); }, hint: 'g s', hidden: isEditor, run: () => { location.href = '/settings'; } },
    { get label() { return T('palette.cmd.newPost'); }, hint: 'g n', run: () => { location.href = '/posts/new'; } },
    { get label() { return T('palette.cmd.sync'); }, run: () => postForm('/sync') },
    { get label() { return T('palette.cmd.themeAuto'); }, run: () => window.gcSetTheme('auto') },
    { get label() { return T('palette.cmd.themeLight'); }, run: () => window.gcSetTheme('light') },
    { get label() { return T('palette.cmd.themeDark'); }, run: () => window.gcSetTheme('dark') },
    { get label() { return T('palette.cmd.shortcuts'); }, hint: '?', run: () => showHelp() },
    {
      get label() { return window.gcGhost && !window.gcGhost.enabled() ? T('palette.cmd.ghostOn') : T('palette.cmd.ghostOff'); },
      run: () => { if (window.gcGhost && window.gcGhost.toggle()) window.gcGhost.show(); },
    },
  ];

  let posts = null; // loaded the first time the palette opens
  async function loadPosts() {
    if (posts) return posts;
    try {
      const res = await fetch('/api/posts');
      posts = (await res.json()).posts || [];
    } catch (e) {
      posts = [];
    }
    return posts;
  }

  function pageCommands() {
    return Array.from(document.querySelectorAll('[data-palette]')).map((el) => ({
      label: el.getAttribute('data-palette'),
      hint: el.getAttribute('data-shortcut') || '',
      run: () => el.click(),
    }));
  }

  // ---------- dialog ----------
  const dialog = document.createElement('dialog');
  dialog.className = 'palette';
  dialog.setAttribute('aria-label', T('palette.label'));
  dialog.innerHTML =
    '<input type="search" class="palette-input" autocomplete="off" />' +
    '<ul class="palette-list" role="listbox"></ul>' +
    '<p class="palette-foot"></p>';
  document.body.appendChild(dialog);
  const input = dialog.querySelector('input');
  const list = dialog.querySelector('ul');
  input.placeholder = T('palette.placeholder');
  input.setAttribute('aria-label', T('palette.inputLabel'));
  list.setAttribute('aria-label', T('palette.results'));
  dialog.querySelector('.palette-foot').textContent = T('palette.foot');
  let items = [];
  let active = 0;

  function score(label, q) {
    const l = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!q) return 1;
    if (l.includes(q)) return 2 - l.indexOf(q) / 1000;
    // all words of the query, in any order
    return q.split(' ').every((w) => l.includes(w)) ? 1 : 0;
  }

  function render() {
    const q = input.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const commands = [...pageCommands(), ...GLOBAL.filter((c) => !(c.hidden && c.hidden()))].map((c) => ({ ...c, group: T('palette.groupCommands') }));
    const postItems = (posts || []).map((p) => ({
      label: p.title,
      hint: p.kindLabel,
      group: T('palette.groupPosts'),
      run: () => { location.href = '/posts/' + encodeURIComponent(p.id); },
    }));
    items = [...commands, ...postItems]
      .map((it) => ({ it, s: score(it.label, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => (q ? b.s - a.s : 0))
      .slice(0, 40)
      .map((x) => x.it);
    active = Math.min(active, Math.max(items.length - 1, 0));
    list.innerHTML = '';
    let lastGroup = '';
    items.forEach((it, i) => {
      if (it.group !== lastGroup) {
        lastGroup = it.group;
        const h = document.createElement('li');
        h.className = 'palette-group';
        h.setAttribute('role', 'presentation');
        h.textContent = it.group;
        list.appendChild(h);
      }
      const li = document.createElement('li');
      li.className = 'palette-item' + (i === active ? ' is-active' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.id = 'palette-item-' + i;
      const label = document.createElement('span');
      label.textContent = it.label;
      li.appendChild(label);
      if (it.hint) {
        const hint = document.createElement('kbd');
        hint.textContent = it.hint;
        li.appendChild(hint);
      }
      li.addEventListener('click', () => choose(i));
      list.appendChild(li);
    });
    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'palette-empty';
      li.textContent = T('palette.noResults');
      list.appendChild(li);
    }
    input.setAttribute('aria-activedescendant', items.length ? 'palette-item-' + active : '');
    const el = document.getElementById('palette-item-' + active);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const it = items[i];
    if (!it) return;
    dialog.close();
    it.run();
  }

  async function open() {
    input.value = '';
    active = 0;
    render();
    dialog.showModal();
    input.focus();
    await loadPosts();
    render();
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  // ---------- shortcuts help ----------
  const help = document.createElement('dialog');
  help.className = 'palette';
  help.setAttribute('aria-label', T('palette.help.title'));
  document.body.appendChild(help);
  function showHelp() {
    const rows = [
      ['⌘K / Ctrl+K', T('palette.help.palette')],
      ['?', T('palette.help.help')],
      ['g d / g j / g s', T('palette.help.go')],
      ['g n', T('palette.help.newPost')],
      // Only the shortcuts that work on this page.
      ...(document.querySelector('[data-post-row]')
        ? [['j / k', T('palette.help.move')], [T('palette.help.enter'), T('palette.help.open')], ['x', T('palette.help.select')]]
        : []),
      ...Array.from(document.querySelectorAll('[data-shortcut][data-palette]')).map((el) => [el.getAttribute('data-shortcut'), el.getAttribute('data-palette')]),
      ...(document.querySelector('[data-edit-form]') ? [['⌘S / Ctrl+S', T('palette.help.save')]] : []),
    ];
    help.innerHTML =
      '<h2 class="palette-title"></h2><dl class="palette-help">' +
      rows.map((r) => '<dt><kbd></kbd></dt><dd></dd>').join('') +
      '</dl><p class="palette-foot"></p>';
    help.querySelector('h2').textContent = T('palette.help.title');
    help.querySelector('.palette-foot').textContent = T('palette.help.foot');
    const dts = help.querySelectorAll('kbd');
    const dds = help.querySelectorAll('dd');
    rows.forEach((r, i) => { dts[i].textContent = r[0]; dds[i].textContent = r[1]; });
    help.showModal();
  }
  help.addEventListener('click', (e) => { if (e.target === help) help.close(); });

  // ---------- keyboard ----------
  let pendingG = false;
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (dialog.open) dialog.close();
      else open();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e) || dialog.open || help.open) return;
    if (pendingG) {
      pendingG = false;
      if (e.key === 'd') { location.href = '/'; return; }
      if (e.key === 'j') { location.href = '/jobs'; return; }
      if (e.key === 's' && !isEditor()) { location.href = '/settings'; return; }
      if (e.key === 'n') { location.href = '/posts/new'; return; }
    }
    if (e.key === 'g') { pendingG = true; setTimeout(() => { pendingG = false; }, 800); return; }
    if (e.key === '?') { e.preventDefault(); showHelp(); return; }
    const target = document.querySelector('[data-shortcut="' + CSS.escape(e.key.toLowerCase()) + '"]');
    if (target) { e.preventDefault(); target.click(); }
  });

  window.gcOpenPalette = open;
})();

// The header's search button (no inline onclick: the CSP forbids it).
document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('[data-open-palette]')) window.gcOpenPalette();
});
