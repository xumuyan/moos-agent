import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import AppShell from './AppShell';
import WorkspaceSidebar from './Sidebar';
import ConversationPane from './ConversationPane';
import RightPanel from './RightPanel';
import ComposerDock from './ComposerDock';

describe('AppShell', () => {
  it('provides the DSH-style semantic shell without claiming future plugins', () => {
    render(<AppShell
      sidebar={<WorkspaceSidebar><button>项目</button><button>会话</button></WorkspaceSidebar>}
      conversation={<ConversationPane header={<h1>会话标题</h1>} notices={<div>状态</div>} composer={<ComposerDock><textarea aria-label="输入" /></ComposerDock>}><div>对话与轨迹</div></ConversationPane>}
      rightPanel={<RightPanel projectName="项目" projectPath="/work/project" activeTasks={1} />}
    />);

    expect(screen.getByRole('complementary', { name: '工作区与会话' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: '对话工作区' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '上下文面板' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: '任务输入区' })).toBeInTheDocument();
    expect(screen.queryByText(/插件市场|Token 统计已启用/)).not.toBeInTheDocument();
  });

  it('collapses navigation, supports keyboard resizing and overlays it on a narrow window', async () => {
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    const user = userEvent.setup();
    const { container, unmount } = render(<AppShell rail={<span>Moos</span>} sidebar={<WorkspaceSidebar>project navigation</WorkspaceSidebar>} conversation={<ConversationPane>chat</ConversationPane>} />);
    const separator = screen.getByRole('separator', { name: '调整侧栏宽度' });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '296');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '280');
    await user.click(screen.getByRole('button', { name: '收起侧栏' }));
    expect(screen.queryByRole('complementary', { name: '工作区与会话' })).not.toBeInTheDocument();
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true }); fireEvent(window, new Event('resize'));
    await user.click(screen.getByRole('button', { name: '展开侧栏' }));
    expect(container.firstChild).toHaveClass('has-overlay-sidebar');
    await user.click(screen.getByRole('button', { name: '关闭侧栏覆盖层' }));
    expect(container.firstChild).not.toHaveClass('has-overlay-sidebar');
    unmount(); Object.defineProperty(window, 'innerWidth', { value: original, configurable: true });
  });
  it('collapses and restores the context panel with accessible controls', async () => {
    const user = userEvent.setup();
    render(<RightPanel projectName="项目" projectPath="/work/project" activeTasks={0} />);
    await user.click(screen.getByRole('button', { name: '收起上下文面板' }));
    expect(screen.getByRole('complementary', { name: '上下文面板' })).toHaveClass('collapsed');
    await user.click(screen.getByRole('button', { name: '展开上下文面板' }));
    expect(screen.getByRole('complementary', { name: '上下文面板' })).not.toHaveClass('collapsed');
  });
});
