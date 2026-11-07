const form = document.querySelector('form');
const picker = document.querySelector('#profiles');
const status = document.querySelector('#status');
const saveButton = form.querySelector('button[type="submit"]');
const testButton = document.querySelector('#test-connection');
const fields = ['name', 'baseUrl', 'model', 'service', 'api', 'thinkingLevel', 'contextWindow'];
let profiles = [];
let draftRevision = 0;

function select(id) {
  draftRevision++;
  status.textContent = '';
  picker.value = id;
  const profile = profiles.find(item => item.id === id);
  for (const field of fields) form.elements[field].value = profile?.[field] ?? form.elements[field].defaultValue ?? '';
  if (!profile) {
    form.elements.service.value = 'openai';
    form.elements.api.value = 'openai-responses';
    form.elements.thinkingLevel.value = 'off';
  }
  form.elements.api.disabled = form.elements.service.value !== 'openai';
  form.elements.imageInput.checked = profile?.imageInput === true;
  form.elements.apiKey.value = '';
}

function render(rows, id = '') {
  profiles = rows;
  picker.replaceChildren(new Option('新增配置', ''), ...rows.map(item => new Option(item.name, item.id)));
  select(id);
}

picker.addEventListener('change', () => select(picker.value));
form.addEventListener('input', () => {
  draftRevision++;
  status.textContent = '';
});
for (const field of ['baseUrl', 'model', 'service', 'api']) {
  form.elements[field].addEventListener('input', () => { form.elements.imageInput.checked = false; });
}
form.elements.service.addEventListener('change', () => {
  const compatibility = form.elements.service.value !== 'openai';
  if (compatibility) form.elements.api.value = 'openai-completions';
  form.elements.api.disabled = compatibility;
});
function draft(id) {
  const profile = Object.fromEntries(fields.map(field => [field, form.elements[field].value.trim()]));
  return { ...profile, id, imageInput: form.elements.imageInput.checked,
    contextWindow: Number(profile.contextWindow), maxTokens: Math.min(8192, Number(profile.contextWindow)),
    apiKey: form.elements.apiKey.value };
}
function setBusy(busy) {
  saveButton.disabled = testButton.disabled = busy;
}
testButton.addEventListener('click', async () => {
  const revision = draftRevision;
  setBusy(true);
  status.textContent = '正在测试连接';
  try {
    const result = await window.moosModels.test(draft(picker.value));
    if (draftRevision !== revision) return;
    const details = [result.status && 'HTTP ' + result.status, result.elapsedMs + ' 毫秒'].filter(Boolean);
    status.textContent = result.message + ' · ' + details.join(' · ');
  } catch {
    if (draftRevision === revision) status.textContent = '测试连接失败，请重试。';
  } finally { setBusy(false); }
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saveButton.disabled) return;
  const id = picker.value || crypto.randomUUID();
  setBusy(true);
  status.textContent = '正在保存';
  try {
    const rows = await window.moosModels.save(draft(id));
    render(rows, id);
    status.textContent = '已保存。可在会话的模型选择器切换。';
  } catch {
    status.textContent = '保存失败，请检查服务地址、模型 ID 和 API 密钥。更改服务地址时请重新填写密钥。';
  } finally { setBusy(false); }
});
window.moosModels.list().then(rows => render(rows)).catch(() => {
  status.textContent = '读取配置失败。';
});
