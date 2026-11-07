import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import SettingsPanel from './SettingsPanel';

test('source modal owns focus, respects IME Escape, isolates the host and restores its invoking control', async () => {
  const root = document.createElement('div'); root.id='root'; document.body.append(root);
  const invoker = document.createElement('button'); invoker.textContent='open fixture'; root.append(invoker); invoker.focus();
  const close = vi.fn();
  const view = render(<SettingsPanel rows={[{id:'general',label:'通用',icon:null}]} activeId="general" onSelect={() => {}} onClose={close} renderContent={() => <button>last fixture</button>} />);
  expect(root.inert).toBe(true);
  expect(screen.getByRole('tab',{name:'通用'})).toHaveFocus();
  screen.getByRole('button',{name:'last fixture'}).focus();
  await userEvent.keyboard('{Tab}'); expect(screen.getByRole('tab',{name:'通用'})).toHaveFocus();
  fireEvent.compositionStart(document); fireEvent.keyDown(document,{key:'Escape',isComposing:true}); expect(close).not.toHaveBeenCalled();
  fireEvent.compositionEnd(document); fireEvent.keyUp(document,{key:'Escape'});
  await userEvent.keyboard('{Escape}'); expect(close).toHaveBeenCalledTimes(1);
  view.unmount(); expect(root.inert).not.toBe(true); expect(invoker).toHaveFocus(); root.remove();
});
test('source mask closes without changing the active settings section', async () => {
  const close=vi.fn(), select=vi.fn();
  render(<SettingsPanel rows={[{id:'models',label:'模型服务',icon:null}]} activeId="models" onSelect={select} onClose={close} renderContent={() => <p>fixture</p>} />);
  await userEvent.click(screen.getByTestId('settings-mask'));
  expect(close).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled();
});
test('a newer host business dialog owns Escape and Tab instead of closing settings behind it', () => {
  const close=vi.fn();
  render(<SettingsPanel rows={[{id:'models',label:'模型服务',icon:null}]} activeId="models" onSelect={() => {}} onClose={close} renderContent={() => <p>fixture</p>} />);
  const child=document.createElement('div'); child.setAttribute('role','dialog'); child.setAttribute('aria-modal','true');
  const input=document.createElement('input'); child.append(input); document.body.append(child); input.focus();
  fireEvent.keyDown(input,{key:'Escape'}); expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(input,{key:'Tab'}); expect(input).toHaveFocus(); child.remove();
});
