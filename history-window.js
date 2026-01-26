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
    title.textContent = `Question ${item.index}: ${item.question}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const durationText = item.durationMs ? `${Math.round(item.durationMs)} ms` : 'n/a';
    const tokensText = item.totalTokens ? `tokens: ${item.totalTokens}` : 'tokens: n/a';
    const inputText = item.inputTokens ? `in: ${item.inputTokens}` : 'in: n/a';
    const outputText = item.outputTokens ? `out: ${item.outputTokens}` : 'out: n/a';
    meta.textContent = `duration: ${durationText} · ${tokensText} · ${inputText} · ${outputText}`;

    if (item.screenshot) {
      const img = document.createElement('img');
      img.className = 'thumbnail';
      img.src = item.screenshot;
      img.alt = 'Screenshot';
      wrapper.appendChild(img);
    }

    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(item.response, null, 2);

    wrapper.appendChild(title);
    wrapper.appendChild(meta);
    wrapper.appendChild(pre);
    list.appendChild(wrapper);
  });
}

window.historyAPI.onHistoryData((event, items) => {
  renderHistory(items);
});

document.getElementById('closeBtn').addEventListener('click', () => {
  window.close();
});
