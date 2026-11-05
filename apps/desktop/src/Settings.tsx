import { useEffect, useRef, useState } from 'react';
import { Alert, AutoComplete, Button, Form, Input, Popconfirm, Select, Space, Tag } from 'antd';
import type { Provider, RuntimeConfig } from './types';
import { request } from './api';
import SettingsCenter from './settings/SettingsCenter';

interface DiagnosticResult { ok: boolean; code: string; message: string; elapsedMs: number; models?: string[]; status?: number }

interface Values { id?: string; name: string; baseUrl: string; model: string; api: Provider['api']; apiKey?: string }
export default function Settings({ providers, runtime = { taskTimeoutMs: 7200000, allowedTaskTimeouts: [600000, 1800000, 3600000, 7200000, 21600000, 86400000] }, onClose, mutate }: { providers: Provider[]; runtime?: RuntimeConfig; onClose: () => void; mutate: (method: string, params: Record<string, unknown>) => Promise<boolean> }) {
  const [form] = Form.useForm<Values>();
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<'list_models' | 'test_provider'>();
  const [result, setResult] = useState<DiagnosticResult>();
  const [models, setModels] = useState<string[]>([]);
  const revision = useRef(0);
  const active = useRef(true);
  const diagnosing = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; revision.current++; };
  }, []);
  const invalidate = () => {
    revision.current++;
    diagnosing.current = false;
    setPending(undefined);
    setResult(undefined);
    setModels([]);
  };
  const reset = () => { invalidate(); setEditing(undefined); form.resetFields(); };
  const close = () => { invalidate(); active.current = false; onClose(); };
  const diagnose = async (method: 'list_models' | 'test_provider') => {
    if (diagnosing.current || !active.current) return;
    const version = revision.current;
    diagnosing.current = true;
    setPending(method);
    setResult(undefined);
    setModels([]);
    const current = () => active.current && revision.current === version;
    try {
      await form.validateFields(method === 'list_models' ? ['baseUrl', 'api'] : ['baseUrl', 'api', 'model']);
    } catch {
      if (current()) { diagnosing.current = false; setPending(undefined); }
      return;
    }
    if (!current()) return;
    const { baseUrl, api, model, apiKey } = form.getFieldsValue();
    const started = performance.now();
    // Only the native diagnostic contract is displayed; bridge exceptions may contain secrets.
    const safeText = (text: string) => apiKey?.trim() ? text.split(apiKey).join('[已隐藏]').split(apiKey.trim()).join('[已隐藏]') : text;
    try {
      const response = await request<DiagnosticResult>(method, {
        provider: { ...(editing ? { id: editing } : {}), baseUrl, api, model },
        ...(apiKey?.trim() ? { apiKey } : {}),
      });
      if (!current()) return;
      setResult({ ...response, message: safeText(response.message), code: safeText(response.code) });
      if (method === 'list_models' && response.ok) setModels((response.models ?? []).filter(value => !apiKey?.trim() || !value.includes(apiKey.trim())));
    } catch {
      if (current()) setResult({ ok: false, code: 'request_failed', message: '诊断请求失败，请检查服务配置或连接后重试。', elapsedMs: Math.round(performance.now() - started) });
    } finally {
      if (current()) { diagnosing.current = false; setPending(undefined); }
    }
  };
  const save = async (values: Values) => {
    setBusy(true);
    try {
      const { apiKey, ...provider } = values;
      const ok = await mutate('save_provider', { provider: { ...provider, id: editing ?? crypto.randomUUID() }, ...(apiKey?.trim() ? { apiKey } : {}) });
      if (ok) reset();
    } finally { setBusy(false); }
  };
  const modelContent = <>
    <Alert type="info" showIcon message="使用你自己的 GLM 或 OpenAI 兼容服务" description="请填写已确认的服务地址、模型 ID 与协议。能力以实际调用为准；密钥仅交给 Mac 后端保存，不存入浏览器。" />
    <div className="provider-list">{providers.map(p => <div className="provider-row" key={p.id}>
      <div><strong>{p.name}</strong><div className="muted">{p.model} · {p.api}</div><Tag>{p.hasKey === undefined ? '密钥由本机管理' : p.hasKey ? '已保存密钥' : '未保存密钥'}</Tag></div>
      <Space><Button size="small" onClick={() => { invalidate(); setEditing(p.id); form.setFieldsValue({ name: p.name, baseUrl: p.baseUrl, model: p.model, api: p.api, apiKey: '' }); }}>编辑</Button>
        <Popconfirm title="移除此模型服务？" onConfirm={() => mutate('remove_provider', { providerId: p.id })} okText="移除" cancelText="取消"><Button size="small" danger>移除</Button></Popconfirm>
      </Space>
    </div>)}</div>
    <Form form={form} layout="vertical" onFinish={save} onValuesChange={changed => { if (['baseUrl', 'api', 'model', 'apiKey'].some(key => key in changed)) invalidate(); }} initialValues={{ api: 'openai-completions' }}>
      <h3>{editing ? '编辑服务' : '添加服务'}</h3>
      <Form.Item name="name" label="服务名称" rules={[{ required: true, whitespace: true }]}><Input placeholder="例如：我的 GLM 服务" /></Form.Item>
      <Form.Item name="baseUrl" label="服务地址" rules={[{ required: true }, { type: 'url', message: '请输入完整的服务 URL' }]}><Input placeholder="填写服务商提供的 URL" /></Form.Item>
      <div className="form-columns"><Form.Item name="model" label="模型 ID" rules={[{ required: true, whitespace: true }]}><AutoComplete options={models.map(value => ({ value }))} placeholder="填写准确模型 ID" /></Form.Item>
        <Form.Item name="api" label="API 协议" rules={[{ required: true }]}><Select options={['openai-completions', 'openai-responses'].map(value => ({ value, label: value }))} /></Form.Item></div>
      <Form.Item name="apiKey" label="API 密钥" extra={editing ? '留空保留现有密钥。' : '密钥由本机系统凭据存储管理。'}><Input.Password autoComplete="new-password" placeholder={editing ? '留空不修改' : '输入服务密钥（可选）'} /></Form.Item>
      <Space>
        <Button aria-label="获取模型列表" onClick={() => void diagnose('list_models')} disabled={!!pending} loading={pending === 'list_models'}>获取模型列表</Button>
        <Button aria-label="测试模型" onClick={() => void diagnose('test_provider')} disabled={!!pending} loading={pending === 'test_provider'}>测试模型</Button>
      </Space>
      <p className="muted">使用当前未保存的配置诊断，无需保存服务。测试模型会产生少量模型调用费用，不调用工具。</p>
      {result && <Alert showIcon type={result.ok ? 'success' : 'error'} message={result.message}
        description={`${result.code}${result.status === undefined ? '' : ` · HTTP ${result.status}`} · ${result.elapsedMs} ms${result.ok && result.models?.length === 0 ? ' · 未返回模型，可手动填写模型 ID。' : ''}`} />}
      <Space><Button type="primary" htmlType="submit" loading={busy}>保存服务</Button>{editing && <Button onClick={reset}>取消编辑</Button>}</Space>
    </Form>
  </>;
  return <SettingsCenter open onClose={close} modelContent={modelContent} runtime={runtime}
    onTaskTimeoutChange={taskTimeoutMs => mutate('set_task_policy', { taskTimeoutMs })} />;
}
