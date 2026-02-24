// Model selector initialization
async function initModelSelector() {
  try {
    const [models, currentId] = await Promise.all([
      window.historyAPI.getModels(),
      window.historyAPI.getModel()
    ]);

    const select = document.getElementById('modelSelect');
    const badge = document.getElementById('modelBadge');

    // Group models
    const groups = {};
    models.forEach(m => {
      if (!groups[m.group]) groups[m.group] = [];
      groups[m.group].push(m);
    });

    Object.entries(groups).forEach(([groupName, groupModels]) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = groupName;
      groupModels.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label;
        if (m.id === currentId) opt.selected = true;
        optgroup.appendChild(opt);
      });
      select.appendChild(optgroup);
    });

    function updateBadge(modelId) {
      const m = models.find(x => x.id === modelId);
      if (!m || !badge) return;
      badge.textContent = m.group;
      badge.className = 'model-badge ' + m.group.toLowerCase();
    }
    updateBadge(currentId);

    select.addEventListener('change', async () => {
      const newId = select.value;
      await window.historyAPI.setModel(newId);
      updateBadge(newId);
    });
  } catch (err) {
    console.error('Model selector init failed:', err);
  }
}

initModelSelector();

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

    // Dynamic pricing from reasoner response _meta, with fallback defaults
    const reasonerMeta = item.reasonerResponse?._meta;
    const reasonerPricing = reasonerMeta?.pricing || { input: 1.75, output: 14 };
    const reasonerLabel = reasonerMeta?.label || 'Reasoner';
    const cuaLabel = 'CUA';
    const cuaPricing = { input: 3, output: 12 };
    const ttsPricing = { input: 0.6, output: 12 };
    const ttsLabel = 'GPT-4o-mini-tts';

    const reasonerCost = computeCost({ input: reasonerUsage.input, output: reasonerUsage.output }, reasonerPricing);
    const cuaCost = computeCost({ input: cuaInput, output: cuaOutput }, cuaPricing);
    const ttsCost = ttsWasEnabled
      ? computeCost({ input: ttsInput, output: ttsOutput }, ttsPricing)
      : 0;

    const models = [
      {
        model: reasonerLabel,
        input: reasonerUsage.input,
        output: reasonerUsage.output,
        total: reasonerUsage.total,
        cost: reasonerCost
      },
      {
        model: cuaLabel,
        input: cuaInput,
        output: cuaOutput,
        total: cuaTotal,
        cost: cuaCost
      }
    ];
    if (ttsWasEnabled) {
      models.push({
        model: `${ttsLabel} (est)`,
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

    const totalRuntimeMs = (Number(item.reasonerDurationMs) || 0) + (Number(item.cuaElapsedMs) || 0);

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
