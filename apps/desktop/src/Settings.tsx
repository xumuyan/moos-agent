import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Tag } from 'antd';
import type { Provider } from './types';

interface Values { id?: string; name: string; baseUrl: string; model: string; api: Provider['api']; apiKey?: string }
export default function Settings({ providers, onClose, mutate }: { providers: Provider[]; onClose: () => void; mutate: (method: string, params: Record<string, unknown>) => Promise<boolean> }) {
  const [form] = Form.useForm<Values>();
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const reset = () => { setEditing(undefined); form.resetFields(); };
  const save = async (values: Values) => {
    setBusy(true);
    try {
      const { apiKey, ...provider } = values;
      const ok = await mutate('save_provider', { provider: { ...provider, id: editing ?? crypto.randomUUID() }, ...(apiKey?.trim() ? { apiKey } : {}) });
      if (ok) reset();
    } finally { setBusy(false); }
  };
  return <Modal title="模型服务设置" open onCancel={onClose} footer={null} destroyOnHidden width={600}>
    <Alert type="info" showIcon message="使用你自己的 GLM 或 OpenAI 兼容服务" description="请填写已确认的服务地址、模型 ID 与协议。能力以实际调用为准；密钥仅交给 Mac 后端保存，不存入浏览器。" />
    <div className="provider-list">{providers.map(p => <div className="provider-row" key={p.id}>
      <div><strong>{p.name}</strong><div className="muted">{p.model} · {p.api}</div><Tag>{p.hasKey === undefined ? '密钥由本机管理' : p.hasKey ? '已保存密钥' : '未保存密钥'}</Tag></div>
      <Space><Button size="small" onClick={() => { setEditing(p.id); form.setFieldsValue({ name: p.name, baseUrl: p.baseUrl, model: p.model, api: p.api, apiKey: '' }); }}>编辑</Button>
        <Popconfirm title="移除此模型服务？" onConfirm={() => mutate('remove_provider', { providerId: p.id })} okText="移除" cancelText="取消"><Button size="small" danger>移除</Button></Popconfirm>
      </Space>
    </div>)}</div>
    <Form form={form} layout="vertical" onFinish={save} initialValues={{ api: 'openai-completions' }}>
      <h3>{editing ? '编辑服务' : '添加服务'}</h3>
      <Form.Item name="name" label="服务名称" rules={[{ required: true, whitespace: true }]}><Input placeholder="例如：我的 GLM 服务" /></Form.Item>
      <Form.Item name="baseUrl" label="服务地址" rules={[{ required: true }, { type: 'url', message: '请输入完整的服务 URL' }]}><Input placeholder="填写服务商提供的 URL" /></Form.Item>
      <div className="form-columns"><Form.Item name="model" label="模型 ID" rules={[{ required: true, whitespace: true }]}><Input placeholder="填写准确模型 ID" /></Form.Item>
        <Form.Item name="api" label="API 协议" rules={[{ required: true }]}><Select options={['openai-completions', 'openai-responses'].map(value => ({ value, label: value }))} /></Form.Item></div>
      <Form.Item name="apiKey" label="API 密钥" extra={editing ? '留空保留现有密钥。' : '密钥由本机系统凭据存储管理。'}><Input.Password autoComplete="new-password" placeholder={editing ? '留空不修改' : '输入服务密钥（可选）'} /></Form.Item>
      <Space><Button type="primary" htmlType="submit" loading={busy}>保存服务</Button>{editing && <Button onClick={reset}>取消编辑</Button>}</Space>
    </Form>
  </Modal>;
}
