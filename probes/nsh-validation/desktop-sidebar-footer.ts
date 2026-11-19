// Native adaptation of Maid patches.css:457–475 plus live footer observation.
// Explicit tree mode replaces the webpage :has([role="tree"]) condition.
export function sidebarFooter(width: number, treeMode: boolean) {
  const swagHeight = Math.max(54, Math.min(94, width * .2575));
  return {
    height: swagHeight + 82,
    swagHeight,
    settingsTop: swagHeight + 2,
    settingsHeight: 36,
    settingsInset: 18,
    mascotVisible: !treeMode,
    mascotWidth: Math.min(320, width * .82),
    mascotBottom: swagHeight + 94,
  } as const;
}
