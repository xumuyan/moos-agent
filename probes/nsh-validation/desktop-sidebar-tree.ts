// Current-page observation, not CSS export. Only active project's sessions are
// available from the six-method bridge; never invent another project's history.
export const sidebarTree = {
  newSessionHeight: 48,
  newSessionMarginTop: -2, // parent gap10 => 8pt below the brand plate
  navigationRowHeight: 38,
  workspaceHeight: 38,
  projectHeight: 54,
  sessionHeight: 36,
  projectTextRightInset: 36, // preserve ribbon end-cap safety from scroll_fix
  fontFamily: '"Songti SC", Georgia, serif', // Mac's built-in serif; no font assets
  branchX: 8,
  branchWidth: 10,
} as const;
export function projectTreeHeight(selected: boolean, sessionCount: number) {
  return sidebarTree.projectHeight + (selected ? Math.max(0, sessionCount) * sidebarTree.sessionHeight : 0);
}

export function sessionTreeState(
  row: { projectId: string; id: string },
  selected: { projectId: string; sessionId: string },
  conversation?: { scope: { projectId: string; sessionId: string }; busy: boolean },
) {
  return {
    selected: selected.projectId === row.projectId && selected.sessionId === row.id,
    working: conversation?.scope.projectId === row.projectId && conversation.scope.sessionId === row.id && conversation.busy,
  };
}
