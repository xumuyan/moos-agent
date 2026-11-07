import { useState } from 'react';
import { Button, Dropdown, Tag } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';

export type PermissionMode = 'ask' | 'assist' | 'full';
const KEY = 'moos.permission-mode';
const MODES: { key: PermissionMode; label: string; description: string }[] = [
  { key: 'ask', label: '请求批准', description: '编辑外部文件或使用互联网时始终询问' },
  { key: 'assist', label: '帮我批准', description: '仅对检测到风险的操作请求批准' },
  { key: 'full', label: '完全访问权限', description: '不增加任务内确认，但系统权限仍由 macOS 控制' },
];

function initial(): PermissionMode {
  const value = localStorage.getItem(KEY);
  return MODES.some(mode => mode.key === value) ? value as PermissionMode : 'assist';
}

export default function PermissionMenu() {
  const [mode, setMode] = useState<PermissionMode>(initial);
  const current = MODES.find(item => item.key === mode)!;
  return <div className="permission-control">
    <Dropdown trigger={['click']} menu={{
      selectable: true,
      selectedKeys: [mode],
      items: MODES.map(item => ({ key: item.key, label: <span><strong>{item.label}</strong><small>{item.description}</small></span> })),
      onSelect: ({ key }) => { const next = key as PermissionMode; localStorage.setItem(KEY, next); setMode(next); },
    }}>
      <Button size="small" icon={<SafetyCertificateOutlined />} aria-label={`权限模式：${current.label}`}>{current.label}</Button>
    </Dropdown>
    <span className="permission-note" title="执行策略后端接入计划中；此选择不能绕过 macOS 权限。">执行策略后端接入计划中；此选择不能绕过 macOS 权限。</span>
    <Tag>计划中</Tag>
  </div>;
}
