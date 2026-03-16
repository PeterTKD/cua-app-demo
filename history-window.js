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
  const formatFailureReason = (value) => {
    if (!value) return 'n/a';
    return String(value).replace(/_/g, ' ');
  };

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

  const createRuntimeTable = (rows) => {
    const wrap = document.createElement('div');
    wrap.className = 'metrics-wrap';

    const table = document.createElement('table');
    table.className = 'metrics-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Stage', 'Detail', 'Time'].forEach((label) => {
      headRow.appendChild(createCell('th', label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      if (row.isTotal) {
        tr.className = 'totals-row';
      }
      tr.appendChild(createCell('td', row.stage));
      tr.appendChild(createCell('td', row.detail));
      tr.appendChild(createCell('td', formatMs(row.time)));
      tbody.appendChild(tr);
    });

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

    let grokInput = 0;
    let grokOutput = 0;
    let grokTotal = 0;
    if (Array.isArray(item.treeLocatorResponses)) {
      item.treeLocatorResponses.forEach((entry) => {
        const usage = extractUsageTotals(entry?.response);
        if (usage) {
          grokInput += usage.input;
          grokOutput += usage.output;
          grokTotal += usage.total;
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
    const grokMeta = item.treeLocatorResponses?.find((entry) => entry?.response?._meta)?.response?._meta || null;
    const grokPricing = grokMeta?.pricing || { input: 0.2, output: 0.5 };
    const grokLabel = grokMeta?.label || 'Grok Tree Locator';
    const cuaLabel = 'CUA';
    const cuaPricing = { input: 3, output: 12 };
    const ttsPricing = { input: 0.6, output: 12 };
    const ttsLabel = 'GPT-4o-mini-tts';

    const reasonerCost = computeCost({ input: reasonerUsage.input, output: reasonerUsage.output }, reasonerPricing);
    const grokCost = computeCost({ input: grokInput, output: grokOutput }, grokPricing);
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
        model: grokLabel,
        input: grokInput,
        output: grokOutput,
        total: grokTotal,
        cost: grokCost
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
      totalInput: reasonerUsage.input + grokInput + cuaInput + ttsInput,
      totalOutput: reasonerUsage.output + grokOutput + cuaOutput + ttsOutput,
      totalTokens: reasonerUsage.total + grokTotal + cuaTotal + ttsTotal,
      totalCost: reasonerCost + grokCost + cuaCost + ttsCost
    };

    const totalRuntimeMs = Number(item.totalRunDurationMs)
      || ((Number(item.reasonerDurationMs) || 0) + (Number(item.executorElapsedMs) || 0));

    const executorLabel = item.actionExecutor ? String(item.actionExecutor).toUpperCase() : 'NONE';
    const uiaStatus = item.uiaAttempted
      ? (item.uiaSucceeded ? 'UIA succeeded' : `UIA failed (${formatFailureReason(item.uiaFailureReason)})`)
      : 'UIA not attempted';
    const summary = document.createElement('div');
    summary.className = 'summary';
    summary.textContent = `Reasoner: ${formatMs(item.reasonerDurationMs)} | ${uiaStatus} | Tree: ${formatMs(item.treeResolveElapsedMs)} | UIA: ${formatMs(item.uiaElapsedMs)} | Executor: ${executorLabel} | Executor time: ${formatMs(item.executorElapsedMs)} | Total: ${formatMs(totalRuntimeMs)} | Cost: ${formatMoney(metrics.totalCost)}`;
    wrapper.appendChild(summary);

    if (item.thought) {
      const thoughtCard = document.createElement('div');
      thoughtCard.className = 'thought-card';

      const thoughtLabel = document.createElement('div');
      thoughtLabel.className = 'thought-label';
      thoughtLabel.textContent = 'Thought';

      const thoughtBody = document.createElement('div');
      thoughtBody.className = 'thought-body';
      thoughtBody.textContent = String(item.thought);

      thoughtCard.appendChild(thoughtLabel);
      thoughtCard.appendChild(thoughtBody);
      wrapper.appendChild(thoughtCard);
    }

    wrapper.appendChild(createMetricsTable(metrics));
    wrapper.appendChild(createRuntimeTable([
      { stage: 'Reasoner', detail: reasonerLabel, time: item.reasonerDurationMs },
      {
        stage: 'Tree Resolve',
        detail: item.uiaAttempted ? `UI tree acquisition${item.uiaFailureReason ? `, ${formatFailureReason(item.uiaFailureReason)}` : ''}` : 'Not attempted',
        time: item.treeResolveElapsedMs
      },
      { stage: 'Grok Locator', detail: `${Array.isArray(item.treeLocatorResponses) ? item.treeLocatorResponses.length : 0} call(s)`, time: item.treeLocatorElapsedMs },
      {
        stage: 'UIA Attempt',
        detail: item.uiaAttempted
          ? (item.uiaSucceeded ? 'Matched element and highlighted it' : `Fell back to CUA, ${formatFailureReason(item.uiaFailureReason)}`)
          : 'Not attempted',
        time: item.uiaElapsedMs
      },
      { stage: 'CUA Model', detail: `${Array.isArray(item.cuaResponses) ? item.cuaResponses.length : 0} call(s)`, time: item.cuaElapsedMs },
      { stage: 'Executor', detail: executorLabel, time: item.executorElapsedMs },
      { stage: 'Run Total', detail: 'End-to-end', time: totalRuntimeMs, isTotal: true }
    ]));

    const pre = document.createElement('pre');
    const payload = {
      question: item.question || null,
      answer: item.answer || null,
      action: item.actionType || null,
      executor: item.actionExecutor || null,
      actionSummary: item.actionSummary || null,
      uia: {
        attempted: item.uiaAttempted === true,
        succeeded: item.uiaSucceeded === true,
        failureReason: item.uiaFailureReason || null,
        treeResolveMs: item.treeResolveElapsedMs || 0,
        totalAttemptMs: item.uiaElapsedMs || 0
      },
      timings: {
        reasonerMs: item.reasonerDurationMs || 0,
        treeResolveMs: item.treeResolveElapsedMs || 0,
        grokMs: item.treeLocatorElapsedMs || 0,
        uiaMs: item.uiaElapsedMs || 0,
        cuaMs: item.cuaElapsedMs || 0,
        executorMs: item.executorElapsedMs || 0,
        totalMs: totalRuntimeMs || 0
      },
      reasoner: item.reasonerResponse || null,
      grok: item.treeLocatorResponses || [],
      cua: item.cuaResponses || [],
      thought: item.thought || null
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
