import { Button, Space, Tag } from 'antd';
import { useState } from 'react';
import ThemePreview from '../themes/ThemePreview';
import type { ThemeDefinition } from '../themes/schema';

export default function ThemeSection({ themes, activeId, onApply }: { themes: ThemeDefinition[]; activeId: string; onApply: (id: string) => void }) {
  const [previewId, setPreviewId] = useState(activeId === 'default' ? themes[0]?.id : activeId);
  const preview = themes.find(theme => theme.id === previewId) ?? themes.find(theme => theme.id === activeId) ?? themes[0];
  return <section><h3>主题</h3><p>皮肤只能修改白名单 Token、固定区域样式和静态图片。预览不保存，加载失败会恢复 Moos 默认主题。</p>
    <div className="theme-choices"><Button type={activeId === 'default' ? 'primary' : 'default'} onClick={() => onApply('default')}>Moos 默认{activeId === 'default' && <Tag color="success">已应用</Tag>}</Button>{themes.map(theme => <Button key={theme.id} type={preview?.id === theme.id ? 'primary' : 'default'} onClick={() => setPreviewId(theme.id)}>{theme.name}{activeId === theme.id && <Tag color="success">已应用</Tag>}</Button>)}</div>
    {preview && <><ThemePreview theme={preview} /><Space><Button type="primary" onClick={() => onApply(preview.id)}>应用此皮肤</Button><span className="muted">显式应用后才保存</span></Space></>}
  </section>;
}
