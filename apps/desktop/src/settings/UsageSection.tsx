import { useEffect, useState } from 'react';
import { Alert, Button, Popconfirm } from 'antd';
import type { Conversation, Project, Provider, UsageExport, UsageSummary } from '../types';
import UsageMetric from '../usage/UsageMetric';
import { SlotHost } from '../plugins/slots';

const token = (value: number | null) => value === null ? '暂无数据' : value.toLocaleString();
const percent = (value: number | null) => value === null ? '暂无数据' : `${(value * 100).toFixed(1)}%`;
const cost = (value: number | null) => value === null ? '暂无数据' : `$${value.toFixed(6)}`;

export default function UsageSection({ providers, projects, conversations, loadUsage, clearUsage, exportUsage }: {
  providers: Provider[]; projects: Project[]; conversations: Conversation[];
  loadUsage: (params: Record<string, string>) => Promise<UsageSummary>;
  clearUsage: () => Promise<number>;
  exportUsage: () => Promise<UsageExport>;
}) {
  const [range, setRange] = useState('today');
  const [providerId, setProviderId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [summary, setSummary] = useState<UsageSummary>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const params = { range, ...(providerId ? { providerId } : {}), ...(projectId ? { projectId } : {}), ...(conversationId ? { conversationId } : {}) };
  const refresh = async () => {
    setBusy(true); setError('');
    try { setSummary(await loadUsage(params)); }
    catch { setError('无法读取用量统计，请稍后重试。'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); }, [range, providerId, projectId, conversationId]); // eslint-disable-line react-hooks/exhaustive-deps
  const download = async () => {
    try {
      const data = await exportUsage();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'moos-usage.json'; anchor.click(); URL.revokeObjectURL(url);
    } catch { setError('导出用量记录失败。'); }
  };
  return <section><h3>用量</h3>
    <p className="muted">仅统计模型实际返回的 Token。缓存字段、上下文上限或可靠价格缺失时显示“暂无数据”，不按字符估算。</p>
    <div className="usage-filters">
      <label>时间<select aria-label="统计时间范围" value={range} onChange={event => setRange(event.target.value)}>
        <option value="today">今日</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option><option value="all">累计</option>
      </select></label>
      <label>服务<select aria-label="筛选模型服务" value={providerId} onChange={event => setProviderId(event.target.value)}><option value="">全部</option>{providers.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>项目<select aria-label="筛选项目" value={projectId} onChange={event => { setProjectId(event.target.value); setConversationId(''); }}><option value="">全部</option>{projects.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>会话<select aria-label="筛选会话" value={conversationId} onChange={event => setConversationId(event.target.value)}><option value="">全部</option>{conversations.filter(item => !projectId || item.projectId === projectId).map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
    </div>
    {error && <Alert type="error" showIcon message={error} />}
    <div className="usage-metrics" aria-busy={busy}>
      <UsageMetric label="输入 Token" value={token(summary?.inputTokens ?? 0)} />
      <UsageMetric label="输出 Token" value={token(summary?.outputTokens ?? 0)} />
      <UsageMetric label="缓存读取" value={token(summary?.cacheReadTokens ?? null)} />
      <UsageMetric label="缓存命中率" value={percent(summary?.cacheHitRate ?? null)} note="cacheRead / (input + cacheRead)" />
      <UsageMetric label="推理 Token" value={token(summary?.reasoningTokens ?? null)} />
      <UsageMetric label="费用（USD）" value={cost(summary?.costUsd ?? null)} />
      <UsageMetric label="最新上下文" value={summary?.contextTokens !== null && summary?.contextWindow ? `${token(summary?.contextTokens ?? null)} / ${token(summary.contextWindow)}` : '暂无数据'} />
      <UsageMetric label="记录数" value={token(summary?.recordCount ?? 0)} />
      <SlotHost slot="usage.metric" context={summary} />
    </div>
    <div className="usage-actions"><Button onClick={() => void download()}>导出 JSON</Button>
      <Popconfirm title="清空全部本地用量记录？" okText="确认清空" cancelText="取消" onConfirm={async () => { await clearUsage(); await refresh(); }}><Button danger aria-label="清空用量记录">清空记录</Button></Popconfirm>
    </div>
  </section>;
}
