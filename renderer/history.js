const history = [];

export function addHistoryItem({
  question,
  response,
  screenshot,
  durationMs,
  inputTokens,
  outputTokens,
  totalTokens
}) {
  history.unshift({
    id: crypto.randomUUID(),
    question,
    response,
    screenshot,
    durationMs,
    inputTokens,
    outputTokens,
    totalTokens,
    timestamp: new Date()
  });

  if (history.length > 12) {
    history.pop();
  }
}

export function getHistorySnapshot() {
  return history.map((item, index) => ({
    question: item.question,
    response: item.response,
    screenshot: item.screenshot,
    durationMs: item.durationMs,
    inputTokens: item.inputTokens,
    outputTokens: item.outputTokens,
    totalTokens: item.totalTokens,
    index: history.length - index
  }));
}

export function clearHistory() {
  history.length = 0;
}
