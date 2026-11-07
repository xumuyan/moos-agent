import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { DshModelPicker,DshPermissionMenu } from './Picker';
const items=[{id:'a',name:'Alpha',model:'model-a'},{id:'b',name:'Beta',model:'model-b'}];
test('model menu uses real keyboard focus, emits selection, restores trigger and keeps popup portalled',async()=>{
 const change=vi.fn(),user=userEvent.setup(); const {container}=render(<DshModelPicker items={items} value="a" onChange={change}/>);
 const trigger=screen.getByRole('combobox',{name:'选择模型'}); await user.click(trigger);
 expect(container).not.toContainElement(screen.getByRole('menu'));
 expect(screen.getByRole('menuitemradio',{name:'Alpha · model-a'})).toHaveFocus();
 await user.keyboard('{ArrowDown}{Enter}');expect(change).toHaveBeenCalledWith('b');
 await waitFor(()=>expect(screen.queryByRole('menu')).toBeNull());await waitFor(()=>expect(trigger).toHaveFocus());
});
test('Escape and outside pointer dismiss without changing a model; disabled has no menu',async()=>{
 const change=vi.fn(),user=userEvent.setup();const view=render(<DshModelPicker items={items} value="a" onChange={change}/>);
 const trigger=screen.getByRole('combobox'); await user.click(trigger);await user.keyboard('{Escape}');await waitFor(()=>expect(screen.queryByRole('menu')).toBeNull());
 await user.click(trigger);fireEvent.pointerDown(document.body);await waitFor(()=>expect(screen.queryByRole('menu')).toBeNull());expect(change).not.toHaveBeenCalled();
 view.rerender(<DshModelPicker items={items} value="a" onChange={change} disabled/>);expect(trigger).toBeDisabled();
});
test('permission choices persist only presentation preference and visibly retain planned limitation',async()=>{
 localStorage.setItem('moos.permission-mode','assist');const user=userEvent.setup();render(<DshPermissionMenu/>);
 const trigger=screen.getByRole('button',{name:'权限模式：帮我批准'});expect(trigger).toHaveAttribute('title',expect.stringContaining('计划中'));
 expect(screen.getByText('计划中')).toBeInTheDocument();await user.click(trigger);
 await user.click(screen.getByRole('menuitemradio',{name:/完全访问权限/}));expect(localStorage.getItem('moos.permission-mode')).toBe('full');
 await waitFor(()=>expect(screen.getByRole('button',{name:'权限模式：完全访问权限'})).toHaveFocus());localStorage.removeItem('moos.permission-mode');
});
