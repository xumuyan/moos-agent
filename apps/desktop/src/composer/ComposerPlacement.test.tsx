import { render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import App from '../App';
import { request } from '../api';
vi.mock('../api', () => ({ request: vi.fn() }));
test('puts the real model control with permission and send while readings stay outside the input card', async () => {
  vi.mocked(request).mockImplementation(async method => method === 'snapshot' ? {
    projects:[{id:'p',name:'工作项目',path:'/work/project'}], conversations:[{id:'c',projectId:'p',title:'对话'}],
    providers:[{id:'m',name:'本机测试模型',model:'fixture',api:'openai-completions',hasKey:true}], messages:[],tasks:[],events:[],
  } : {});
  const { container } = render(<App />);
  await screen.findByText('今天想完成什么？');
  const card = container.querySelector('.dsh-composer-card') as HTMLElement;
  expect(within(card).getByRole('combobox', {name:'选择模型'})).toBeInTheDocument();
  expect(within(card).getByRole('button', {name:/权限模式/})).toBeInTheDocument();
  expect(within(card).getByRole('button', {name:'发送任务'})).toBeDisabled();
  expect(within(card).queryByText(/缓存命中/)).toBeNull();
  expect(screen.getByText(/缓存命中/)).toBeInTheDocument();
});
