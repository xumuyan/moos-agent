import type { ReactNode } from 'react';

export default function WorkspaceSidebar({ children }: { children: ReactNode }) {
  return <aside className="sidebar workspace-sidebar" aria-label="工作区与会话">{children}</aside>;
}
