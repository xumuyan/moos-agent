import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { expect, test, vi } from 'vitest';
import DshComposer from './DshComposer';

test('sends Enter only for a nonempty enabled draft, preserves Shift and composition',()=>{
 const onSubmit=vi.fn(),onChange=vi.fn();
 const view=render(<DshComposer value="draft" onChange={onChange} onSubmit={onSubmit}/>);
 const input=screen.getByRole('textbox',{name:'任务内容'});
 fireEvent.keyDown(input,{key:'Enter',shiftKey:true});
 fireEvent.compositionStart(input);fireEvent.keyDown(input,{key:'Enter'});fireEvent.compositionEnd(input);
 fireEvent.keyDown(input,{key:'Enter',keyCode:229});
 expect(onSubmit).not.toHaveBeenCalled();
 fireEvent.keyDown(input,{key:'Enter'});expect(onSubmit).toHaveBeenCalledOnce();
 fireEvent.change(input,{target:{value:'next'}});expect(onChange).toHaveBeenCalledWith('next');
 view.rerender(<DshComposer value=" " onChange={onChange} onSubmit={onSubmit}/>);
 expect(screen.getByRole('button',{name:'发送任务'})).toBeDisabled();
});

test('keeps the editor and stateful leading slot mounted between hero and active phases', () => {
  const dispose = vi.fn();
  function TerminalSlot() {
    const [open, setOpen] = useState(false);
    useEffect(() => dispose, []);
    return <button onClick={() => setOpen(true)}>{open ? 'terminal open' : 'open terminal'}</button>;
  }
  const props = {
    value: 'draft',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    leading: <TerminalSlot />,
    workspaceName: '本地项目',
  };
  const view = render(<DshComposer {...props} hero />);
  const editor = screen.getByRole('textbox');
  fireEvent.click(screen.getByRole('button', { name: 'open terminal' }));
  const terminal = screen.getByRole('button', { name: 'terminal open' });

  view.rerender(<DshComposer {...props} running onStop={vi.fn()} />);
  expect(dispose).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox')).toBe(editor);
  expect(screen.getByRole('button', { name: 'terminal open' })).toBe(terminal);
  expect(screen.getByText('本地项目')).not.toBeVisible();

  view.rerender(<DshComposer {...props} hero />);
  expect(screen.getByRole('textbox')).toBe(editor);
  expect(screen.getByRole('button', { name: 'terminal open' })).toBe(terminal);
  expect(screen.getByText('本地项目')).toBeVisible();
  expect(dispose).not.toHaveBeenCalled();
  view.unmount();
  expect(dispose).toHaveBeenCalledOnce();
});

test('uses independent headline, workspace and bar seats in the hero composer stack', () => {
  const view = render(<DshComposer value="" onChange={vi.fn()} onSubmit={vi.fn()} hero workspaceName="本地项目" />);
  const stack = screen.getByRole('contentinfo', { name: '任务输入区' });
  const [headlineSeat, workspaceSeat, inputSeat] = Array.from(stack.children);
  expect(headlineSeat).toContainElement(screen.getByRole('heading', { level: 2, name: '今天想完成什么？' }));
  expect(workspaceSeat).toContainElement(screen.getByText('本地项目'));
  expect(workspaceSeat.querySelector('button')).toBeNull();
  expect(inputSeat).toContainElement(screen.getByRole('textbox'));
  expect(view.container.querySelector('[data-composer-card]')?.parentElement).toBe(inputSeat);
});
test('keeps actual controls inside the copied toolbar and readings outside the card; stops a running task',()=>{
 const onStop=vi.fn();const {container}=render(<DshComposer value="" onChange={()=>{}} onSubmit={()=>{}} running onStop={onStop}
 leading={<div>terminal slot</div>} permission={<button>permission</button>} model={<button>model</button>} readings={<span>actual readings</span>}/>);
 const card=container.querySelector('[data-composer-card]')!;
 expect(card).toContainElement(screen.getByRole('button',{name:'model'}));
 expect(card).toContainElement(screen.getByRole('button',{name:'permission'}));
 expect(card).not.toContainElement(screen.getByText('actual readings'));
 expect(screen.getAllByText('terminal slot')).toHaveLength(1);
 expect(screen.getByRole('textbox')).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'停止任务'}));expect(onStop).toHaveBeenCalledOnce();
});
