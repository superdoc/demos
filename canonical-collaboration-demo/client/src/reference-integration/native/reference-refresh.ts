// Coalesce local/remote editor transactions into a native-catalog re-read.
// The caller recreates this scheduler when the document identity changes.
export function createReferenceRefresh(refresh: () => void, delay = 300) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstPending = 0;
  let disposed = false;
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    firstPending = 0;
    if (!disposed) refresh();
  }
  return {
    invalidate() {
      if (disposed) return;
      firstPending ||= Date.now();
      clearTimeout(timer);
      // Continuous streaming must not starve the panel refresh indefinitely.
      timer = setTimeout(flush, Math.max(0, Math.min(delay, 1500 - (Date.now() - firstPending))));
    },
    dispose() { disposed = true; clearTimeout(timer); },
  };
}
