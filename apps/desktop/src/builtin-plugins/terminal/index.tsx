import { lazy, Suspense } from 'react';
import { message } from 'antd';
import type { PluginRegistry } from '../../plugins/registry';
import { nativeTerminalAvailable, terminalRequest } from './api';
const TerminalDock = lazy(() => import('./TerminalDock'));
export function registerTerminalPlugin(registry: PluginRegistry) {
  registry.register({ id: 'dev.moos.terminal', name: '项目终端（受信任内置）', version: '1.0.0', type: 'integration', moosVersion: '^0.1.0', entry: 'builtin:terminal', slots: ['composer.leading'], permissions: ['ui:slots'] }, [{
    slot: 'composer.leading', render: context => {
      const placement = context as { projectId?: string; panelTargetId?: string } | undefined;
      return <Suspense fallback={null}>
        <TerminalDock projectId={String(placement?.projectId ?? '')} panelTargetId={placement?.panelTargetId} />
      </Suspense>;
    },
    activate: () => () => { if (nativeTerminalAvailable()) void terminalRequest('close_all').catch(() => { void message.error('终端未全部关闭，请重新启用终端插件后关闭标签；目录锁保持。'); }); },
  }]);
}
