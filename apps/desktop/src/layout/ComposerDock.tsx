import type { ReactNode } from 'react';

export default function ComposerDock({ children }: { children: ReactNode }) {
  return <footer className="composer composer-dock" aria-label="任务输入区">{children}</footer>;
}
