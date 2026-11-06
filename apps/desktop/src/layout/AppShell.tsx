import type { ReactNode } from 'react';

export default function AppShell({ rail, sidebar, conversation, rightPanel }: {
  rail?: ReactNode;
  sidebar: ReactNode;
  conversation: ReactNode;
  rightPanel?: ReactNode;
}) {
  return <div className="desktop-shell app-shell workbench-shell">
    {rail}
    {sidebar}
    {conversation}
    {rightPanel}
  </div>;
}
