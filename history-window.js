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

  const extractUsageTotals = (response) => {
    if (!response) {
      return null;
    }
    const usage = response.usage || response?.usage_metadata || null;
    if (!usage || (usage.total_tokens == null && usage.input_tokens == null && usage.output_tokens == null)) {
      return null;
    }
    const input = Number(usage.input_tokens ?? 0);
    const output = Number(usage.output_tokens ?? 0);
    const total = Number(usage.total_tokens ?? (input + output));
    return { input, output, total };
  };

  const formatMs = (value) => (Number.isFinite(value) ? `${Math.round(value)} ms` : 'n/a');
  const formatTokens = (value) => (Number.isFinite(value) ? String(Math.round(value)) : 'n/a');

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
      const reasonerDuration = formatMs(item.reasonerDurationMs);
      const cuaDurations = Array.isArray(item.cuaResponses)
        ? item.cuaResponses.map((entry, idx) => `CUA ${idx + 1}: ${formatMs(entry.durationMs)}`).join(' | ')
        : 'CUA: n/a';

      const reasonerUsage = extractUsageTotals(item.reasonerResponse);
      const reasonerTokens = reasonerUsage ? formatTokens(reasonerUsage.total) : 'n/a';

      let cuaTotalTokens = 0;
      let cuaHasTokens = false;
      if (Array.isArray(item.cuaResponses)) {
        item.cuaResponses.forEach((entry) => {
          const usage = extractUsageTotals(entry?.response);
          if (usage) {
            cuaHasTokens = true;
            cuaTotalTokens += usage.total;
          }
        });
      }
      const cuaTokens = cuaHasTokens ? formatTokens(cuaTotalTokens) : 'n/a';

      const totalRuntimeMs = (Number(item.reasonerDurationMs) || 0)
        + (Array.isArray(item.cuaResponses)
          ? item.cuaResponses.reduce((sum, entry) => sum + (Number(entry.durationMs) || 0), 0)
          : 0);
      const totalTokens = cuaHasTokens && reasonerUsage
        ? formatTokens(cuaTotalTokens + reasonerUsage.total)
        : 'n/a';

      meta.textContent = `reasoner: ${reasonerDuration} (${reasonerTokens} tokens) - ${cuaDurations} (${cuaTokens} tokens) - total: ${formatMs(totalRuntimeMs)} (${totalTokens} tokens)`;
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
