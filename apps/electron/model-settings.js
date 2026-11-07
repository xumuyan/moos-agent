const form = document.querySelector('form');
const picker = document.querySelector('#profiles');
const status = document.querySelector('#status');
const saveButton = form.querySelector('button');
const fields = ['name', 'baseUrl', 'model', 'service', 'api', 'thinkingLevel', 'contextWindow'];
let profiles = [];

function select(id) {
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
for (const field of ['baseUrl', 'model', 'service', 'api']) {
  form.elements[field].addEventListener('input', () => { form.elements.imageInput.checked = false; });
}
form.elements.service.addEventListener('change', () => {
  const compatibility = form.elements.service.value !== 'openai';
  if (compatibility) form.elements.api.value = 'openai-completions';
  form.elements.api.disabled = compatibility;
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const id = picker.value || crypto.randomUUID();
  const profile = Object.fromEntries(fields.map(field => [field, form.elements[field].value.trim()]));
  saveButton.disabled = true;
  status.textContent = '正在保存';
  try {
    const rows = await window.moosModels.save({ ...profile, id, imageInput: form.elements.imageInput.checked,
      contextWindow: Number(profile.contextWindow),
      maxTokens: Math.min(8192, Number(profile.contextWindow)), apiKey: form.elements.apiKey.value });
    render(rows, id);
    status.textContent = '已保存。可在会话的模型选择器切换。';
  } catch {
    status.textContent = '保存失败，请检查服务地址、模型 ID 和 API 密钥。更改服务地址时请重新填写密钥。';
  } finally { saveButton.disabled = false; }
});
window.moosModels.list().then(rows => render(rows)).catch(() => {
  status.textContent = '读取配置失败。';
});
