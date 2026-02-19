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

  const PRICE_PER_MILLION = {
    reasoner: { input: 1.75, output: 14, label: 'GPT-5.2' },
    cua: { input: 3, output: 12, label: 'CUA' },
    tts: { input: 0.6, output: 12, label: 'GPT-4o-mini-tts' }
  };

  const extractUsageTotals = (response) => {
    if (!response) return null;
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
  const formatMoney = (value) => (Number.isFinite(value) ? `$${value.toFixed(6)}` : 'n/a');

  const estimateTokensFromText = (text) => {
    const cleaned = String(text || '')
      .replace(/<<TASK_COMPLETED>>/g, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/#{1,6}\s+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return 0;
    return Math.max(1, Math.ceil(cleaned.length / 4));
  };

  const computeCost = (usage, pricing) => {
    if (!usage || !pricing) return 0;
    const input = Number(usage.input ?? 0);
    const output = Number(usage.output ?? 0);
    return (input / 1000000) * pricing.input + (output / 1000000) * pricing.output;
  };

  const createCell = (tag, text) => {
    const cell = document.createElement(tag);
    cell.textContent = text;
    return cell;
  };

  const createMetricsTable = (metrics) => {
    const wrap = document.createElement('div');
    wrap.className = 'metrics-wrap';

    const table = document.createElement('table');
    table.className = 'metrics-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Model', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Cost'].forEach((label) => {
      headRow.appendChild(createCell('th', label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    metrics.models.forEach((row) => {
      const tr = document.createElement('tr');
      tr.appendChild(createCell('td', row.model));
      tr.appendChild(createCell('td', formatTokens(row.input)));
      tr.appendChild(createCell('td', formatTokens(row.output)));
      tr.appendChild(createCell('td', formatTokens(row.total)));
      tr.appendChild(createCell('td', formatMoney(row.cost)));
      tbody.appendChild(tr);
    });

    const totalsRow = document.createElement('tr');
    totalsRow.className = 'totals-row';
    totalsRow.appendChild(createCell('td', 'Run Total'));
    totalsRow.appendChild(createCell('td', formatTokens(metrics.totalInput)));
    totalsRow.appendChild(createCell('td', formatTokens(metrics.totalOutput)));
    totalsRow.appendChild(createCell('td', formatTokens(metrics.totalTokens)));
    totalsRow.appendChild(createCell('td', formatMoney(metrics.totalCost)));
    tbody.appendChild(totalsRow);

    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  };

  items.forEach((item) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'item';

    const title = document.createElement('h4');
    if (item.type === 'note') {
      title.textContent = `Event ${item.index}: ${item.message || ''}`;
    } else {
      title.textContent = `Question ${item.index}: ${item.question}`;
    }
    wrapper.appendChild(title);

    if (item.screenshot) {
      const img = document.createElement('img');
      img.className = 'thumbnail';
      img.src = item.screenshot;
      img.alt = 'Screenshot';
      wrapper.appendChild(img);
    }

    if (item.type === 'note') {
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = 'note';
      wrapper.appendChild(meta);
      list.appendChild(wrapper);
      return;
    }

    const reasonerUsage = extractUsageTotals(item.reasonerResponse) || { input: 0, output: 0, total: 0 };

    let cuaInput = 0;
    let cuaOutput = 0;
    let cuaTotal = 0;
    if (Array.isArray(item.cuaResponses)) {
      item.cuaResponses.forEach((entry) => {
        const usage = extractUsageTotals(entry?.response);
        if (usage) {
          cuaInput += usage.input;
          cuaOutput += usage.output;
          cuaTotal += usage.total;
        }
      });
    }

    const ttsWasEnabled = item.ttsEnabled === true;
    const ttsInput = ttsWasEnabled ? estimateTokensFromText(item.answer) : 0;
    const ttsOutput = ttsWasEnabled ? ttsInput : 0;
    const ttsTotal = ttsInput + ttsOutput;

    const reasonerCost = computeCost({ input: reasonerUsage.input, output: reasonerUsage.output }, PRICE_PER_MILLION.reasoner);
    const cuaCost = computeCost({ input: cuaInput, output: cuaOutput }, PRICE_PER_MILLION.cua);
    const ttsCost = ttsWasEnabled
      ? computeCost({ input: ttsInput, output: ttsOutput }, PRICE_PER_MILLION.tts)
      : 0;

    const models = [
      {
        model: PRICE_PER_MILLION.reasoner.label,
        input: reasonerUsage.input,
        output: reasonerUsage.output,
        total: reasonerUsage.total,
        cost: reasonerCost
      },
      {
        model: PRICE_PER_MILLION.cua.label,
        input: cuaInput,
        output: cuaOutput,
        total: cuaTotal,
        cost: cuaCost
      }
    ];
    if (ttsWasEnabled) {
      models.push({
        model: `${PRICE_PER_MILLION.tts.label} (est)`,
        input: ttsInput,
        output: ttsOutput,
        total: ttsTotal,
        cost: ttsCost
      });
    }

    const metrics = {
      models,
      totalInput: reasonerUsage.input + cuaInput + ttsInput,
      totalOutput: reasonerUsage.output + cuaOutput + ttsOutput,
      totalTokens: reasonerUsage.total + cuaTotal + ttsTotal,
      totalCost: reasonerCost + cuaCost + ttsCost
    };

    const totalRuntimeMs = (Number(item.reasonerDurationMs) || 0)
      + (Array.isArray(item.cuaResponses)
        ? item.cuaResponses.reduce((sum, entry) => sum + (Number(entry.durationMs) || 0), 0)
        : 0);

    const summary = document.createElement('div');
    summary.className = 'summary';
    summary.textContent = `Reasoner: ${formatMs(item.reasonerDurationMs)} | CUA calls: ${Array.isArray(item.cuaResponses) ? item.cuaResponses.length : 0} | Run time: ${formatMs(totalRuntimeMs)} | Run cost: ${formatMoney(metrics.totalCost)}`;
    wrapper.appendChild(summary);

    wrapper.appendChild(createMetricsTable(metrics));

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

    list.appendChild(wrapper);
  });
}

window.historyAPI.onHistoryData((event, items) => {
  renderHistory(items);
});

document.getElementById('closeBtn').addEventListener('click', () => {
  window.close();
});
