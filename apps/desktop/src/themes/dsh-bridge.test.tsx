import { render, screen } from '@testing-library/react';
import { expect,test,vi } from 'vitest';
import DshComposer from '../vendor/dsh/composer/DshComposer';
import DshNavigation from '../vendor/dsh/sidebar/DshNavigation';
import RightPanel from '../layout/RightPanel';
import { applyTheme,resetTheme } from './loader';
import { BUILTIN_THEMES } from './builtin';
test('retains versioned skin region seats while original DSH components own their paint',()=>{
 render(<><DshNavigation wide toggle={vi.fn()} projects={[]} conversations={null} onProject={vi.fn()} onRemove={vi.fn()} onAdd={vi.fn()} onNew={vi.fn()} newDisabled={false} onSettings={vi.fn()} panels={[]}/><DshComposer value="" onChange={vi.fn()} onSubmit={vi.fn()}/><RightPanel activeTasks={0}/></>);
 expect(screen.getByRole('complementary',{name:'工作区与会话'})).toHaveClass('workspace-sidebar');
 expect(screen.getByRole('contentinfo',{name:'任务输入区'})).toHaveClass('composer-dock');
 expect(screen.getByRole('complementary',{name:'上下文面板'})).toHaveClass('right-panel');
 applyTheme({...BUILTIN_THEMES[1],styles:{sidebar:{backgroundColor:'#fefefe'},composer:{backgroundColor:'#ffffff'}}});
 expect(document.documentElement.dataset.moosTheme).toBe(BUILTIN_THEMES[1].id);
 expect(document.getElementById('moos-theme-regions')?.textContent).toContain('.workspace-sidebar{');
 expect(document.getElementById('moos-theme-regions')?.textContent).toContain('.composer-dock{');
 resetTheme();expect(document.documentElement.dataset.moosTheme).toBeUndefined();
});
