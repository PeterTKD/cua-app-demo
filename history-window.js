function renderHistory(items) {
  const list = document.getElementById('historyList');
  list.textContent = '';

  if (!items || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No history yet.';
    list.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'item';

    const title = document.createElement('h4');
    if (item.type === 'note') {
      title.textContent = `Event ${item.index}: ${item.message || ''}`;
    } else {
      title.textContent = `Question ${item.index}: ${item.question}`;
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    if (item.type === 'note') {
      meta.textContent = 'note';
    } else {
      const reasonerDuration = item.reasonerDurationMs ? `${Math.round(item.reasonerDurationMs)} ms` : 'n/a';
      const cuaDurations = Array.isArray(item.cuaResponses)
        ? item.cuaResponses.map((entry, idx) => `CUA ${idx + 1}: ${entry.durationMs ? Math.round(entry.durationMs) : 'n/a'} ms`).join(' | ')
        : 'CUA: n/a';
      meta.textContent = `reasoner: ${reasonerDuration} - ${cuaDurations}`;
    }

    if (item.screenshot) {
      const img = document.createElement('img');
      img.className = 'thumbnail';
      img.src = item.screenshot;
      img.alt = 'Screenshot';
      wrapper.appendChild(img);
    }

    if (item.type !== 'note') {
      const pre = document.createElement('pre');
      const payload = {
        question: item.question || null,
        answer: item.answer || null,
        action: item.actionType || null,
        actionSummary: item.actionSummary || null,
        reasoner: item.reasonerResponse || null,
        cua: item.cuaResponses || []
      };
      pre.textContent = JSON.stringify(payload, null, 2);
      wrapper.appendChild(pre);
    }

    wrapper.appendChild(title);
    wrapper.appendChild(meta);
    list.appendChild(wrapper);
  });
}

window.historyAPI.onHistoryData((event, items) => {
  renderHistory(items);
});

document.getElementById('closeBtn').addEventListener('click', () => {
  window.close();
});
