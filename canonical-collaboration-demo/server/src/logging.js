const selectedServices = new Set((process.env.LOG_SERVICES ?? 'all').split(',').map((value) => value.trim()));

export function serviceLoggingEnabled(component) {
  const normalized = component.replaceAll('-', '');
  return selectedServices.has('all') || selectedServices.has(normalized);
}

export function logEvent(component, event, fields = {}) {
  if (!serviceLoggingEnabled(component)) return;
  console.log(`[${component}] ${JSON.stringify({ event, ...fields })}`);
}
