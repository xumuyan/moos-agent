export const ALLOWED_TASK_TIMEOUTS = Object.freeze([600000, 1800000, 3600000, 7200000, 21600000, 86400000]);
export const DEFAULT_TASK_TIMEOUT_MS = 7200000;

export function taskTimeout(value = DEFAULT_TASK_TIMEOUT_MS) {
  if (!Number.isSafeInteger(value) || !ALLOWED_TASK_TIMEOUTS.includes(value)) throw new Error('Invalid task timeout');
  return value;
}
