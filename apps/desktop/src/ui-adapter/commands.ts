type Bridge = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

const METHODS = new Set([
  'pick_directory', 'add_project', 'remove_project', 'create_conversation', 'rename_conversation',
  'submit', 'cancel', 'history_page', 'history_row',
]);
const SENSITIVE = /^(api[-_]?key|authorization|password|secret|token)$/i;

export interface UiCommand {
  method: string;
  params: Record<string, unknown>;
}

const command = (method: string, params: Record<string, unknown> = {}): UiCommand => ({ method, params });

export const uiCommands = {
  pickDirectory: () => command('pick_directory'),
  addProject: (path: string) => command('add_project', { path }),
  removeProject: (projectId: string) => command('remove_project', { projectId }),
  createConversation: (projectId: string, title: string) => command('create_conversation', { projectId, title }),
  renameConversation: (projectId: string, conversationId: string, title: string) => command('rename_conversation', { projectId, conversationId, title }),
  submit: (conversationId: string, message: string, providerId: string) => command('submit', { conversationId, message, providerId }),
  cancelTask: (taskId: string) => command('cancel', { taskId }),
};

function hasSensitiveKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasSensitiveKey);
  return Object.entries(value).some(([key, nested]) => SENSITIVE.test(key) || hasSensitiveKey(nested));
}

export async function executeUiCommand<T = unknown>(bridge: Bridge, value: UiCommand): Promise<T> {
  if (!value || typeof value !== 'object' || !METHODS.has(value.method)) {
    throw new Error('Unsupported UI command');
  }
  if (!value.params || typeof value.params !== 'object' || Array.isArray(value.params)) {
    throw new Error('Invalid UI command parameters');
  }
  if (hasSensitiveKey(value.params)) throw new Error('Sensitive UI command parameter');
  return (Object.keys(value.params).length
    ? bridge(value.method, value.params)
    : bridge(value.method)) as Promise<T>;
}
