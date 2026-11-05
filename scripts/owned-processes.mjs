const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

export async function waitForExitedPids(pids, timeoutMs = 10000) {
  const remaining = new Set(pids);
  const deadline = Date.now() + timeoutMs;
  while (remaining.size) {
    for (const pid of [...remaining]) {
      if (!processExists(pid)) remaining.delete(pid);
    }
    if (!remaining.size || Date.now() >= deadline) break;
    await delay(Math.min(50, Math.max(1, deadline - Date.now())));
  }
  return remaining;
}

export async function waitForChildExit(exited, timeoutMs = 10000) {
  let timer;
  try {
    return await Promise.race([
      exited.then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function cleanupOwnedProcesses(child, exited, pids, timeoutMs = 10000) {
  const errors = [];
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (!child.kill('SIGKILL')) errors.push(new Error('failed to signal packaged app during cleanup'));
    } catch (error) { errors.push(error); }
  }
  for (const pid of pids) {
    try { if (processExists(pid)) process.kill(pid, 'SIGKILL'); } catch (error) { errors.push(error); }
  }
  try {
    if (!await waitForChildExit(exited, timeoutMs) && child.exitCode === null && child.signalCode === null) {
      errors.push(new Error('packaged app did not exit during cleanup'));
    }
  } catch (error) { errors.push(error); }
  try {
    const remaining = await waitForExitedPids([child.pid, ...pids], timeoutMs);
    if (remaining.size) errors.push(new Error(`owned processes still running after cleanup: ${[...remaining].join(', ')}`));
  } catch (error) { errors.push(error); }
  return errors;
}
