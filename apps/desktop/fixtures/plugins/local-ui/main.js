moos.registerSlot('composer.trailing', context => ({
  type: 'badge',
  tone: 'success',
  text: `沙箱已连接${context.projectId ? ` · ${context.projectId.slice(0, 8)}` : ''}`,
}));
moos.registerSlot('settings.section', context => context.section === 'plugins' ? {
  type: 'group',
  children: [
    { type: 'text', text: '本地插件正在独立 Worker 中运行' },
    { type: 'button', text: '测试通知', action: 'notify' }
  ]
} : null);
moos.registerAction('notify', () => moos.notify('沙箱通知通道正常'));
