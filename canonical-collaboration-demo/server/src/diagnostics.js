const megabytes = (bytes) => Math.round((bytes / 1_000_000) * 10) / 10;
const selectedServices = new Set((process.env.LOG_SERVICES ?? 'all').split(',').map((value) => value.trim()));

export function serviceLoggingEnabled(component) {
  const normalized = component.replaceAll('-', '');
  return selectedServices.has('all') || selectedServices.has(normalized);
}

export function memoryUsage() {
  const memory = process.memoryUsage();
  return {
    rssMb: megabytes(memory.rss),
    heapUsedMb: megabytes(memory.heapUsed),
    heapTotalMb: megabytes(memory.heapTotal),
    externalMb: megabytes(memory.external),
  };
}

export function logEvent(component, event, fields = {}) {
  if (!serviceLoggingEnabled(component)) return;
  console.log(`[${component}] ${JSON.stringify({ event, ...fields, memory: memoryUsage() })}`);
}
