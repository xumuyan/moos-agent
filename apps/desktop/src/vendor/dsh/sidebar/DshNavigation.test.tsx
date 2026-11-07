import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import DshNavigation from './DshNavigation';
import browser from './WorkspaceBrowser.module.css';
import rows from './Rows.module.css';
test('ports real workspace/sidebar seats without unavailable global entries',()=>{
 const select=vi.fn(),remove=vi.fn();
 render(<DshNavigation wide toggle={()=>{}} projects={[{id:'p',name:'项目',path:'/work',selected:true,runningTasks:0}]} conversations={<button>当前会话</button>} onProject={select} onRemove={remove} onAdd={()=>{}} onNew={()=>{}} newDisabled={false} onSettings={()=>{}} panels={[{id:'usage',label:'用量',icon:<span/>,onClick:()=>{}}]}/>);
 fireEvent.click(screen.getByRole('button',{name:'项目'})); expect(select).toHaveBeenCalledWith('p');
 fireEvent.click(screen.getByRole('button',{name:'移除项目 项目'}));expect(remove).toHaveBeenCalledWith('p');expect(select).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('button',{name:'当前会话'})).toBeVisible();
 expect(screen.queryByText('自动化任务')).toBeNull();
});

test('keeps the original workspace icon and text seats as siblings', () => {
  const noop = () => {};
  render(<DshNavigation
    wide toggle={noop} onProject={noop} onRemove={noop} onAdd={noop}
    onNew={noop} newDisabled={false} onSettings={noop} panels={[]}
    projects={[
      { id: 'p', name: '当前项目', path: '/work', selected: true, runningTasks: 0 },
      { id: 'q', name: '其他项目', path: '/other', selected: false, runningTasks: 0 },
    ]}
    conversations={<button>当前会话</button>}
  />);

  const selected = screen.getByRole('button', { name: '当前项目' });
  const [folder, chevron, label] = selected.children;
  expect(folder).toHaveClass(rows.slot, rows.folder, rows.folderActive);
  expect(folder.querySelector('use')?.getAttribute('href')).toMatch(/folder-open/);
  expect(chevron).toHaveClass(rows.slot, rows.chevron);
  expect(chevron.querySelector('svg')).toHaveClass(rows.arrow, rows.arrowOpen);
  expect(label).toHaveClass(rows.projectText);
  expect(label).toHaveTextContent('当前项目');
  expect(label.querySelector('svg')).toBeNull();
  expect(screen.getByRole('button', { name: '其他项目' }).querySelector('use')?.getAttribute('href')).toMatch(/folder-close/);

  const searchSeat = screen.getByText('工作区').nextElementSibling;
  expect(searchSeat).toHaveClass(browser.searchSlot);
  expect(searchSeat).toBeEmptyDOMElement();
  expect(searchSeat).toHaveAttribute('aria-hidden', 'true');
  expect(searchSeat?.nextElementSibling).toContainElement(screen.getByRole('button', { name: '添加项目' }));
});
