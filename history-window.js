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
    const cached = Number(usage.cached_input_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0);
    const output = Number(usage.output_tokens ?? 0);
    const total = Number(usage.total_tokens ?? (input + output));
    return { input, cached, output, total };
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
    const cached = Number(usage.cached ?? 0);
    const output = Number(usage.output ?? 0);
    const nonCachedInput = Math.max(0, input - cached);
    const cachedRate = Number.isFinite(pricing.cached_input) ? pricing.cached_input : pricing.input;
    return (nonCachedInput / 1000000) * pricing.input + (cached / 1000000) * cachedRate + (output / 1000000) * pricing.output;
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
    let cuaCached = 0;
    let cuaOutput = 0;
    let cuaTotal = 0;
    if (Array.isArray(item.cuaResponses)) {
      item.cuaResponses.forEach((entry) => {
        const usage = extractUsageTotals(entry?.response);
        if (usage) {
          cuaInput += usage.input;
          cuaCached += usage.cached;
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
    const cuaMeta = item.cuaResponses?.find((entry) => entry?.response?._meta)?.response?._meta || null;
    const cuaLabel = cuaMeta?.label || 'CUA-5.4';
    const cuaPricing = cuaMeta?.pricing || { input: 2.5, output: 15, cached_input: 0.25 };
    const ttsPricing = { input: 0.6, output: 12 };
    const ttsLabel = 'GPT-4o-mini-tts';

    const reasonerCost = computeCost({ input: reasonerUsage.input, output: reasonerUsage.output }, reasonerPricing);
    const grokCost = computeCost({ input: grokInput, output: grokOutput }, grokPricing);
    const cuaCost = computeCost({ input: cuaInput, cached: cuaCached, output: cuaOutput }, cuaPricing);
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

    const setupElapsedMs = Number(item.setupElapsedMs) || 0;
    const reasonerElapsedMs = Number(item.reasonerDurationMs) || 0;
    const treeResolveElapsedMs = Number(item.treeResolveElapsedMs) || 0;
    const treeLocatorElapsedMs = Number(item.treeLocatorElapsedMs) || 0;
    const uiaElapsedMs = Number(item.uiaElapsedMs) || 0;
    const cuaElapsedMs = Number(item.cuaElapsedMs) || 0;
    const executorElapsedMs = Number(item.executorElapsedMs) || 0;
    const totalRuntimeMs = Number(item.totalRunDurationMs)
      || (reasonerElapsedMs + executorElapsedMs);

    const executorLabel = item.actionExecutor ? String(item.actionExecutor).toUpperCase() : 'NONE';
    const treeOverlappedReasoner = treeResolveElapsedMs > 0 && reasonerElapsedMs > 0;
    const executorDuplicatesUia = executorLabel === 'UIA' && Math.abs(executorElapsedMs - uiaElapsedMs) <= 20;
    const executorDuplicatesCua = executorLabel === 'CUA-5.4' && Math.abs(executorElapsedMs - cuaElapsedMs) <= 20;
    const showExecutorRow = executorElapsedMs > 0 && !executorDuplicatesUia && !executorDuplicatesCua;
    const uiaStatus = item.uiaAttempted
      ? (item.uiaSucceeded ? 'UIA succeeded' : `UIA failed (${formatFailureReason(item.uiaFailureReason)})`)
      : 'UIA not attempted';
    const summary = document.createElement('div');
    summary.className = 'summary';
    const treeSummaryLabel = treeOverlappedReasoner ? 'Tree Prefetch' : 'Tree';
    const treeSummarySuffix = treeOverlappedReasoner ? ' (parallel)' : '';
    const summaryParts = [
      `Prep: ${formatMs(setupElapsedMs)}`,
      `Reasoner: ${formatMs(reasonerElapsedMs)}`,
      `${treeSummaryLabel}: ${formatMs(treeResolveElapsedMs)}${treeSummarySuffix}`,
      `${uiaStatus}`,
      `UIA Total: ${formatMs(uiaElapsedMs)}`,
      `Resolver: ${executorLabel}`,
      `Total: ${formatMs(totalRuntimeMs)}`,
      `Cost: ${formatMoney(metrics.totalCost)}`
    ];
    if (showExecutorRow) {
      summaryParts.splice(6, 0, `Guidance Total: ${formatMs(executorElapsedMs)}`);
    }
    summary.textContent = summaryParts.join(' | ');
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
    const runtimeRows = [
      { stage: 'Prep', detail: 'Overlay reset, native capture, context build', time: setupElapsedMs },
      { stage: 'Reasoner', detail: reasonerLabel, time: reasonerElapsedMs },
      {
        stage: treeOverlappedReasoner ? 'Tree Prefetch' : 'Tree Resolve',
        detail: item.uiaAttempted
          ? `UI tree acquisition${treeOverlappedReasoner ? ' (overlapped with reasoner)' : ''}${item.uiaFailureReason ? `, ${formatFailureReason(item.uiaFailureReason)}` : ''}`
          : 'Not attempted',
        time: treeResolveElapsedMs
      },
      {
        stage: 'Grok Locator',
        detail: `${Array.isArray(item.treeLocatorResponses) ? item.treeLocatorResponses.length : 0} call(s)${item.uiaAttempted ? ', included in UIA total' : ''}`,
        time: treeLocatorElapsedMs
      },
      {
        stage: 'UIA Total',
        detail: item.uiaAttempted
          ? (item.uiaSucceeded ? 'Tree lookup, locator call, and element match' : `Fell back to CUA-5.4, ${formatFailureReason(item.uiaFailureReason)}`)
          : 'Not attempted',
        time: uiaElapsedMs
      },
      { stage: 'CUA-5.4', detail: `${Array.isArray(item.cuaResponses) ? item.cuaResponses.length : 0} call(s)`, time: cuaElapsedMs }
    ];
    if (showExecutorRow) {
      runtimeRows.push({ stage: 'Guidance Total', detail: executorLabel, time: executorElapsedMs });
    }
    runtimeRows.push({ stage: 'Run Total', detail: 'End-to-end', time: totalRuntimeMs, isTotal: true });
    wrapper.appendChild(createRuntimeTable(runtimeRows));

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
        setupMs: setupElapsedMs || 0,
        reasonerMs: reasonerElapsedMs || 0,
        treeResolveMs: treeResolveElapsedMs || 0,
        grokMs: treeLocatorElapsedMs || 0,
        uiaMs: uiaElapsedMs || 0,
        cuaMs: cuaElapsedMs || 0,
        executorMs: executorElapsedMs || 0,
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
