// Jobs tab: live-refreshes running jobs (progress and latest
// message). When one finishes the page reloads to move it to the table.
(function () {

  const cards = () => Array.from(document.querySelectorAll('[data-active-job]'));
  if (cards().length === 0) return;

  async function tick() {
    try {
      const res = await fetch('/api/jobs/active');
      const data = await res.json();
      const byId = new Map(data.jobs.map((j) => [j.id, j]));
      for (const card of cards()) {
        const job = byId.get(card.getAttribute('data-active-job'));
        if (!job) { window.gcGhost?.queueAfterReload(); location.reload(); return; } // finished (or was cancelled)
        const pct = job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
        card.querySelector('[data-job-progress]').textContent = job.done + '/' + (job.total || '?');
        const bar = card.querySelector('[data-job-bar]');
        bar.style.width = pct + '%';
        bar.parentElement.setAttribute('aria-valuenow', String(job.done));
        bar.parentElement.setAttribute('aria-valuemax', String(job.total));
        card.querySelector('[data-job-last]').textContent = job.last;
      }
      if (data.jobs.some((j) => !document.querySelector('[data-active-job="' + CSS.escape(j.id) + '"]'))) {
        location.reload(); // a new one started
        return;
      }
    } catch (e) {
      // transient failure: retried on the next tick
    }
    setTimeout(tick, 2000);
  }
  tick();
})();
