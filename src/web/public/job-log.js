// Job console: filter the log by level (all / warnings and errors / errors).
(function () {
  const log = document.querySelector('[data-log]');
  if (!log) return;
  const buttons = document.querySelectorAll('[data-log-filter]');
  buttons.forEach((b) => {
    b.addEventListener('click', () => {
      const level = b.getAttribute('data-log-filter');
      log.setAttribute('data-show', level);
      buttons.forEach((x) => {
        const on = x === b;
        x.classList.toggle('is-active', on);
        x.setAttribute('aria-pressed', String(on));
      });
    });
  });
})();
