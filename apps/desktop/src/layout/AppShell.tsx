import type { ReactNode } from 'react';

export default function AppShell({ sidebar, conversation, rightPanel }: {
  sidebar: ReactNode;
  conversation: ReactNode;
  rightPanel: ReactNode;
}) {
  return <div className="desktop-shell app-shell">
    {sidebar}
    {conversation}
    {rightPanel}
  </div>;
}
