import type { ReactNode } from 'react';

export default function ConversationPane({ header, notices, children, composer }: {
  header?: ReactNode;
  notices?: ReactNode;
  children: ReactNode;
  composer?: ReactNode;
}) {
  return <main className="main-panel conversation-pane" aria-label="对话工作区">
    {header}
    {notices}
    {children}
    {composer}
  </main>;
}
