const invoke = (name, args) => window.__TAURI__.core.invoke(name, args);
const $ = id => document.getElementById(id);
async function refreshPermissions() {
  try {
    const result = await invoke('desktop_permissions');
    $('permissions').textContent = `屏幕录制：${result.screenCaptureGranted ? '已授权' : '未授权'}；辅助功能：${result.accessibilityGranted ? '已授权' : '未授权'}`;
    return result;
  } catch { $('permissions').textContent = '权限检查失败，请确认应用安装完整。'; }
}
for (const [id, kind] of [['screen', 'screen'], ['accessibility', 'accessibility']]) {
  $(id).addEventListener('click', async () => {
    $(id).disabled = true;
    try { await invoke('request_desktop_permission', { kind }); await refreshPermissions(); }
    catch { $('permissions').textContent = '权限申请未完成，请在系统设置中检查。'; }
    finally { $(id).disabled = false; }
  });
}
$('refresh').addEventListener('click', refreshPermissions);
$('browser').addEventListener('click', async () => {
  $('browser').disabled = true; $('stop').disabled = false; $('capture').hidden = true;
  $('browser-status').textContent = '正在打开 Safari 并验证测试页面…';
  try {
    const result = await invoke('run_browser_probe');
    if (result.status === 'passed' && result.imageDataUrl) {
      $('capture').src = result.imageDataUrl; $('capture').hidden = false;
      $('browser-status').textContent = '验证通过：已实际输入地址，确认目标页面并返回截图。';
    } else if (result.status === 'cancelled') {
      $('browser-status').textContent = '本次验证已停止。';
    } else if (result.reason === 'system-permission-required') {
      $('browser-status').textContent = '请先授权屏幕录制与辅助功能，再重新验证。';
      await refreshPermissions();
    } else {
      $('browser-status').textContent = `验证未完成：${result.reason ?? result.status}`;
    }
  } catch (error) { $('browser-status').textContent = String(error); }
  finally { $('browser').disabled = false; $('stop').disabled = true; }
});
$('stop').addEventListener('click', async () => {
  const stopped = await invoke('stop_browser_probe');
  if (stopped && $('browser').disabled) $('browser-status').textContent = '正在停止本次验证…';
});
$('run').addEventListener('click', async () => {
  $('run').disabled = true;
  try { $('result').textContent = JSON.stringify(await invoke('run_probe'), null, 2); }
  catch (error) { $('result').textContent = String(error); }
  finally { $('run').disabled = false; }
});
refreshPermissions();
