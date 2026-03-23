const history = [];

export function addHistoryItem({
  question,
  screenshot,
  answer,
  thought,
  ttsEnabled,
  actionType,
  actionExecutor,
  actionSummary,
  reasonerResponse,
  setupElapsedMs,
  reasonerDurationMs,
  treeLocatorElapsedMs,
  treeResolveElapsedMs,
  uiaElapsedMs,
  uiaAttempted,
  uiaSucceeded,
  uiaFailureReason,
  treeLocatorResponses,
  executorElapsedMs,
  cuaElapsedMs,
  cuaResponses,
  totalRunDurationMs
}) {
  history.unshift({
    id: crypto.randomUUID(),
    type: 'question',
    question,
    screenshot,
    answer,
    thought,
    ttsEnabled: ttsEnabled === true,
    actionType,
    actionExecutor,
    actionSummary,
    reasonerResponse,
    setupElapsedMs: Number(setupElapsedMs) || 0,
    reasonerDurationMs,
    treeLocatorElapsedMs: Number(treeLocatorElapsedMs) || 0,
    treeResolveElapsedMs: Number(treeResolveElapsedMs) || 0,
    uiaElapsedMs: Number(uiaElapsedMs) || 0,
    uiaAttempted: uiaAttempted === true,
    uiaSucceeded: uiaSucceeded === true,
    uiaFailureReason: uiaFailureReason ? String(uiaFailureReason) : null,
    treeLocatorResponses: Array.isArray(treeLocatorResponses) ? treeLocatorResponses : [],
    executorElapsedMs: Number(executorElapsedMs) || 0,
    cuaElapsedMs: Number(cuaElapsedMs) || 0,
    cuaResponses: Array.isArray(cuaResponses) ? cuaResponses : [],
    totalRunDurationMs: Number(totalRunDurationMs) || 0,
    timestamp: new Date()
  });

  // Unlimited history (no cap).
}

export function addHistoryNote(message) {
  if (!message) return;
  history.unshift({
    id: crypto.randomUUID(),
    type: 'note',
    message: String(message),
    timestamp: new Date()
  });
  // Unlimited history (no cap).
}

export function getHistorySnapshot() {
  return history.map((item, index) => ({
    type: item.type || 'question',
    question: item.question,
    message: item.message,
    screenshot: item.screenshot,
    answer: item.answer,
    thought: item.thought,
    ttsEnabled: item.ttsEnabled === true,
    actionType: item.actionType,
    actionExecutor: item.actionExecutor,
    actionSummary: item.actionSummary,
    reasonerResponse: item.reasonerResponse,
    setupElapsedMs: item.setupElapsedMs,
    reasonerDurationMs: item.reasonerDurationMs,
    treeLocatorElapsedMs: item.treeLocatorElapsedMs,
    treeResolveElapsedMs: item.treeResolveElapsedMs,
    uiaElapsedMs: item.uiaElapsedMs,
    uiaAttempted: item.uiaAttempted,
    uiaSucceeded: item.uiaSucceeded,
    uiaFailureReason: item.uiaFailureReason,
    treeLocatorResponses: item.treeLocatorResponses,
    executorElapsedMs: item.executorElapsedMs,
    cuaElapsedMs: item.cuaElapsedMs,
    cuaResponses: item.cuaResponses,
    totalRunDurationMs: item.totalRunDurationMs,
    index: history.length - index
  }));
}

export function clearHistory() {
  history.length = 0;
}
