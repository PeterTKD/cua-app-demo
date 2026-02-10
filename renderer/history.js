const history = [];

export function addHistoryItem({
  question,
  screenshot,
  reasonerResponse,
  reasonerDurationMs,
  cuaResponses
}) {
  history.unshift({
    id: crypto.randomUUID(),
    type: 'question',
    question,
    screenshot,
    reasonerResponse,
    reasonerDurationMs,
    cuaResponses: Array.isArray(cuaResponses) ? cuaResponses : [],
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
    reasonerResponse: item.reasonerResponse,
    reasonerDurationMs: item.reasonerDurationMs,
    cuaResponses: item.cuaResponses,
    index: history.length - index
  }));
}

export function clearHistory() {
  history.length = 0;
}
