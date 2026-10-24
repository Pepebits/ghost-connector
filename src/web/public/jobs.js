// Live job console over SSE. `since` is sent as a query param (the native
// Last-Event-ID isn't used) so it can resume after a page refresh
// by reading the last id already rendered in the DOM on load.
const jobsT = (k, v) => (window.gcT ? window.gcT(k, v) : k);

function startJobStream(jobId, sinceId, doneCount, total, opts) {
  let since = sinceId;
  let done = doneCount;
  const liveOpts = opts || {};
  const stopLiveDraft = liveOpts.postId ? pollLiveDraft(liveOpts.postId) : () => {};

  function appendLine(evt) {
    const log = document.getElementById('log');
    const line = document.createElement('div');
    line.className = 'log-line whitespace-pre-wrap break-words py-0.5' + (evt.level === 'warn' ? ' text-warn' : evt.level === 'error' ? ' text-err' : '');
    line.setAttribute('data-level', evt.level);
    const time = new Date(evt.at).toLocaleTimeString(window.gcLocale);
    line.textContent = '[' + time + '] ' + evt.message;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  // Each finished post (plan/apply/sync) emits its final event with
  // postId + status/kind, at the same time the server increments job.done -- it's
  // the only reliable "one more post finished" signal without having to expose
  // a dedicated progress event.
  function bumpProgressIfDone(evt) {
    if (!total) return; // total not known yet (e.g. a just-started sync): not updated live
    if (!evt.data || !evt.data.postId || (!evt.data.status && !evt.data.kind)) return;
    done = Math.min(done + 1, total);
    const progress = document.getElementById('job-progress');
    const fill = document.getElementById('job-progress-fill');
    if (progress) progress.textContent = done + '/' + total;
    if (fill) fill.style.width = Math.round((done / total) * 100) + '%';
  }

  function connect() {
    const es = new EventSource('/api/jobs/' + jobId + '/events?since=' + since);

    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      since = data.id;
      appendLine(data);
      bumpProgressIfDone(data);
    };

    es.addEventListener('end', () => {
      es.close();
      stopLiveDraft();
      // Single-post plan: straight to its preview. Otherwise, refresh to
      // reflect the final state (cancel button disappears, etc.).
      window.gcGhost?.queueAfterReload(); // a little ghost crosses when the next page loads
      if (liveOpts.redirectTo) location.href = liveOpts.redirectTo;
      else location.reload();
    });

    es.onerror = () => {
      es.close();
      setTimeout(connect, 2000);
    };
  }

  connect();
}

// Writer draft while it writes: lightweight polling (the server replies
// "unchanged" without HTML if there's no new text since `since`).
function pollLiveDraft(postId) {
  let since = 0;
  let stopped = false;
  let follow = true; // auto-scroll while the user hasn't scrolled up to read
  const box = document.getElementById('live-draft');
  const status = document.getElementById('live-draft-status');
  if (!box) return () => {};
  box.addEventListener('scroll', () => {
    follow = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
  });

  async function tick() {
    if (stopped) return;
    try {
      const res = await fetch('/api/posts/' + encodeURIComponent(postId) + '/live-draft?since=' + since);
      const data = await res.json();
      if (data.available && !data.unchanged) {
        since = data.updatedAt;
        box.innerHTML = data.html; // HTML already sanitized on the server
        if (status) status.textContent = jobsT(data.done ? 'jobs.console.draftDone' : 'jobs.console.draftWriting', { count: data.words });
        if (follow) box.scrollTop = box.scrollHeight;
      }
    } catch (e) {
      // transient network failure: retried on the next tick
    }
    setTimeout(tick, 1000);
  }
  tick();
  return () => {
    stopped = true;
  };
}
