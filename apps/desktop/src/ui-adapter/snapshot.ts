import { isActive, type Snapshot } from '../types';
import type { WorkspaceSelection, WorkspaceView } from './types';

export function createWorkspaceView(snapshot: Snapshot, selection: WorkspaceSelection): WorkspaceView {
  const projectSelected = snapshot.projects.some(project => project.id === selection.projectId);
  const selectedProjectId = projectSelected ? selection.projectId : '';
  const conversations = snapshot.conversations.filter(conversation => conversation.projectId === selectedProjectId);
  const conversationSelected = conversations.some(conversation => conversation.id === selection.conversationId);
  const selectedConversationId = conversationSelected ? selection.conversationId : '';
  const activeTasks = snapshot.tasks.filter(isActive);

  return {
    projects: snapshot.projects.map(project => ({
      ...project,
      selected: project.id === selectedProjectId,
      runningTasks: activeTasks.filter(task => task.projectId === project.id).length,
    })),
    conversations: conversations.map(conversation => ({
      id: conversation.id,
      title: conversation.title,
      selected: conversation.id === selectedConversationId,
      running: activeTasks.some(task => task.conversationId === conversation.id),
    })),
    selectedProjectId,
    selectedConversationId,
    activeConversationTaskIds: activeTasks
      .filter(task => task.conversationId === selectedConversationId)
      .map(task => task.id),
    backgroundTaskCount: activeTasks.filter(task => task.conversationId !== selectedConversationId).length,
  };
}
