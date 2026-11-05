export interface WorkspaceSelection {
  projectId: string;
  conversationId: string;
}

export interface ProjectView {
  id: string;
  name: string;
  path: string;
  selected: boolean;
  runningTasks: number;
}

export interface ConversationView {
  id: string;
  title: string;
  selected: boolean;
  running: boolean;
}

export interface WorkspaceView {
  projects: ProjectView[];
  conversations: ConversationView[];
  selectedProjectId: string;
  selectedConversationId: string;
  activeConversationTaskIds: string[];
  backgroundTaskCount: number;
}
