import { cleanup, colorScheme, host, Image, List, signal, Text, View, windowSize, type Bounds, type ScrollEvent } from 'nsh';
import { Button, Input, TextView } from 'nsh/base';
import { DesktopController, type DesktopCall } from './desktop-ui-controller';
import { desktopCall } from './desktop-ui-transport';
import { desktopTheme as t, desktopLayout, styleLayout, clamp, createMessageRows } from './desktop-theme';
import { Art, NineSlice, Wallpaper, TopTrim, BottomTrim, SidebarCorners, artAvailable } from './desktop-theme-layers';
import { liveSidebar } from './desktop-live-sidebar';
import { sidebarTree as tree, projectTreeHeight } from './desktop-sidebar-tree';
import { sidebarFooter } from './desktop-sidebar-footer';
import brandIcon from './assets/desktop/sidebar-icon.png';
export type DesktopActions = { controller: DesktopController; type: (text: string) => void; send: () => void; stop: () => void; project: (id: string) => Promise<void>; session: (id: string) => void; create: () => Promise<void> };
export function DesktopView(props: { ready?: (actions: DesktopActions) => void; call?: DesktopCall; onGeometry?: (name: string, bounds: Bounds) => void; onMessageScroll?: (event: ScrollEvent) => void } = {}) {
  const revision = signal(0), draft = signal(''), right = signal(false), navigation = signal(true);
  const controller = new DesktopController(props.call ?? desktopCall, () => revision.set(revision() + 1));
  function snapshot() { revision(); return controller; }
  const cachedRows = createMessageRows();
  const messageRows = () => {
    const c = snapshot().current;
    return cachedRows(c ? `${c.scope.projectId}/${c.scope.sessionId}` : '', c?.rows ?? []);
  };
  const layout = () => desktopLayout(windowSize().width, right());
  const title = () => snapshot().sessions.find(s => s.id === snapshot().sessionId)?.title ?? '新会话';
  const status = () => snapshot().current ? `${snapshot().current!.task?.status ?? (snapshot().current!.busy ? 'submitting' : 'idle')} · ${snapshot().current!.busy ? (snapshot().current!.stopping ? '停止请求中，等待收尾' : '读取事件中') : snapshot().current!.drained ? '已排空' : '未确认完成'} · ${snapshot().current!.sequence} 事件` : '加载项目/会话';
  const error = () => snapshot().error || snapshot().current?.error ? `Host/任务错误：${snapshot().error || snapshot().current?.error}；不自动重放。任务结果未确认时请勿重复提交。` : snapshot().current?.task?.errorCode ? `任务错误码：${snapshot().current!.task!.errorCode}` : '';
  const detach = host.on('desktop.dispose', () => controller.dispose());
  cleanup(() => { detach(); controller.dispose(); });
  const disabled = () => !draft().trim() || !snapshot().current || snapshot().loading || snapshot().current!.busy || !!snapshot().current!.error || !!snapshot().error;
  function send() { if (disabled()) return; const text = draft(); draft.set(''); void controller.submit(text); }
  const project = async (id: string) => { draft.set(''); await controller.selectProject(id); };
  const session = (id: string) => { draft.set(''); controller.selectSession(id); };
  const create = async () => { draft.set(''); await controller.createSession(); };
  props.ready?.({ controller, type: text => draft.set(text), send, stop: () => void controller.stop(), project, session, create });
  void controller.start();
  const dark = () => colorScheme() === 'dark';
  const ink = () => dark() ? t.dark.ink : t.ink;
  const muted = () => dark() ? '#b7c3dd' : t.muted;
  const button = { borderRadius: 10, padding: 10, backgroundColor: 'transparent' };
  const active = () => !!snapshot().current?.rows.length;
  const safe = () => styleLayout(active(), artAvailable);
  const measured = (name: string) => (e: { bounds: Bounds }) => props.onGeometry?.(name, e.bounds);
  const sidebarStyle = () => liveSidebar(artAvailable, dark());
  const footer = () => sidebarFooter(layout().sidebar, true); // this view always renders a project tree
  const sidebarWidth = () => (!layout().compact || navigation()) ? layout().sidebar : 0;
  return (
    <View testID="desktop-root" style={{ flex: 1, flexDirection: 'row', backgroundColor: dark() ? t.dark.canvas : t.canvas, overflow: 'hidden' }}>
      <Wallpaper sidebar={sidebarWidth()} active={active()} details={layout().right} />
      {(!layout().compact || navigation()) && <View testID="sidebar" onLayout={measured('sidebar')} style={{ width: layout().sidebar, backgroundColor: sidebarStyle().backgroundColor, backgroundImage: sidebarStyle().backgroundImage, boxShadow: t.sidebarShadow, padding: 16, gap: 10, overflow: 'hidden' }}>
        <SidebarCorners />
        <View testID="sidebar-brand" onLayout={measured('sidebar-brand')} style={{ ...sidebarStyle().brand, flexDirection: 'row', alignItems: 'center', gap: 10 }}><Image src={brandIcon} style={{ width: 28, height: 28 }} /><Text style={{ fontSize: 20, color: t.brand, fontFamily: t.fontFamily, fontWeight: '600', textShadow: '0 1px 3px #02071980' }}>沐码</Text></View>
        <View testID="new-session-frame" onLayout={measured('new-session-frame')} style={{ height: tree.newSessionHeight, marginTop: tree.newSessionMarginTop, flexShrink: 0 }}>
          <NineSlice name="new-session" source={[1400,308]} cuts={[0,210,0,210]} edges={[0,layout().compact ? 32 : 40,0,layout().compact ? 32 : 40]} fill style={{ top: 0, left: 0, right: 0, bottom: 0 }} />
          <Button testID="create-session" style={{ height: tree.newSessionHeight, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' }} disabled={snapshot().loading || !snapshot().projectId} disabledStyle={{ opacity: .4 }} onPress={() => void create()}><Text style={{ fontFamily: t.ornamentFont, fontSize: layout().compact ? 14 : 16, fontWeight: '600', color: artAvailable ? '#152246' : t.goldSoft }}>⊕ 新会话</Text></Button>
        </View>
        <View testID="sidebar-navigation" onLayout={measured('sidebar-navigation')} style={{ flexShrink: 0 }}>
          {[['plugins','♧','插件'],['background','☷','后台任务'],['more','⊞','更多']].map(([id, icon, label]) => <Button testID={`nav-${id}-unavailable`} disabled style={{ height: tree.navigationRowHeight, paddingLeft: 4, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'transparent' }}><Text style={{ color: t.sidebarInk, fontSize: 16 }}>{icon}</Text><Text style={{ color: t.sidebarInk, fontSize: 14 }}>{label}</Text></Button>)}
        </View>
        <View testID="workspace-heading" onLayout={measured('workspace-heading')} style={{ height: tree.workspaceHeight, flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 14, fontFamily: t.ornamentFont, color: t.goldSoft }}>工作区</Text>
          <Button testID="search-unavailable" disabled style={{ padding: 2 }}><Text style={{ color: t.goldSoft, fontSize: 17 }}>⌕</Text></Button>
          <Button testID="workspace-options-unavailable" disabled style={{ padding: 2 }}><Text style={{ color: t.goldSoft, fontSize: 17 }}>☷</Text></Button>
          <Button testID="add-project-unavailable" disabled style={{ padding: 2 }}><Text style={{ color: t.goldSoft, fontSize: 17 }}>⊞</Text></Button>
        </View>
        <List testID="projects" each={snapshot().projects} estimatedItemSize={126} style={{ flex: 1, minHeight: 0 }}>
          {p => <View testID={`project-group-${p().id}`} onLayout={measured(`project-group-${p().id}`)} style={{ height: projectTreeHeight(snapshot().projectId === p().id, snapshot().sessions.length) }}>
            <View style={{ height: tree.projectHeight }}>
              {snapshot().projectId === p().id && <NineSlice name="workspace-ribbon" source={[1185,240]} cuts={[0,145,0,140]} edges={[0,36,0,35]} fill style={{ top: -3, left: -12, right: 0, bottom: -3 }} />}
              <Button testID={`project-${p().name}`} style={{ ...button, height: tree.projectHeight, paddingVertical: 7, paddingLeft: 7, paddingRight: tree.projectTextRightInset, flexDirection: 'row', gap: 8, alignItems: 'center' }} onPress={() => void project(p().id)}>
                {artAvailable && <View style={{ width: 30, height: 38, flexShrink: 0 }}><Art name="workspace-shield" style={{ top: 0, left: 0, width: 30, height: 38, objectFit: 'contain' }} /></View>}
                <Text testID={`project-label-${p().id}`} onLayout={measured(`project-label-${p().id}`)} class="line-clamp-1" style={{ flex: 1, minWidth: 0, fontSize: t.font, fontFamily: t.ornamentFont, color: '#f4ead5' }}>{p().name}</Text>
              </Button>
            </View>
            {snapshot().projectId === p().id && <View testID="sessions" onLayout={measured('sessions')} style={{ height: snapshot().sessions.length * tree.sessionHeight }}>
              {snapshot().sessions.map((s, i) => <View style={{ height: tree.sessionHeight }}>
                <View style={{ position: 'absolute', pointerEvents: 'none', left: 8, top: 0, height: i === snapshot().sessions.length - 1 ? 18 : 36, borderLeftWidth: 1, borderColor: '#dfcc9a99' }} />
                <View style={{ position: 'absolute', pointerEvents: 'none', left: 8, top: 18, width: 10, borderTopWidth: 1, borderColor: '#dfcc9a99' }} />
                <Button testID={`session-${s.title}`} style={{ height: tree.sessionHeight, marginLeft: 2, paddingLeft: 22, paddingRight: 9, borderRadius: 7, borderWidth: snapshot().sessionId === s.id ? 1 : 0, borderColor: '#e2be70b8', backgroundImage: snapshot().sessionId === s.id ? 'linear-gradient(90deg, #526fb84d, #2b468b38 72%, #142a5e1f)' : undefined, backgroundColor: 'transparent' }} onPress={() => session(s.id)}>
                  <Text class="line-clamp-1" style={{ fontSize: 13, fontFamily: t.ornamentFont, color: snapshot().sessionId === s.id ? '#fff8e8' : '#d7c8a8' }}>{`${snapshot().sessionId === s.id ? '● ' : ''}${s.title}`}</Text>
                </Button>
              </View>)}
            </View>}
          </View>}
        </List>
        {footer().mascotVisible && <Art testID="sidebar-mascot" name="chibi" style={{ left: layout().sidebar * .52 - footer().mascotWidth / 2, bottom: footer().mascotBottom, width: footer().mascotWidth, height: Math.min(260, windowSize().height * .38), objectFit: 'contain', objectPosition: 'center bottom', opacity: .22, filter: 'brightness(1.08) contrast(1.04)' }} />}
        <View testID="sidebar-footer" onLayout={measured('sidebar-footer')} style={{ height: footer().height, flexShrink: 0, marginHorizontal: -16, marginBottom: -16 }}>
          <Art testID="sidebar-swag" name="sidebar-swag" style={{ top: 0, left: 0, right: 0, height: footer().swagHeight, objectFit: 'fill', filter: 'brightness(1.1) saturate(1.04) contrast(1.04)' }} />
          <Button testID="settings-unavailable" onLayout={measured('sidebar-settings')} disabled style={{ position: 'absolute', top: footer().settingsTop, left: footer().settingsInset, right: footer().settingsInset, height: footer().settingsHeight, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 18, backgroundColor: 'transparent' }}><Text style={{ color: '#e8c77f', fontSize: 17 }}>⚙</Text><Text style={{ color: '#f2dfba', fontSize: 14, fontFamily: t.ornamentFont }}>设置</Text></Button>
        </View>
      </View>}
      <View testID="chat-column" style={{ flex: 1, minWidth: 0 }}>
        <TopTrim active={active()} />
        <View testID="header-safe-area" onLayout={measured('header-safe-area')} style={{ height: safe().headerTop, flexShrink: 0 }} />
        <View testID="chat-header" onLayout={measured('chat-header')} style={{ zIndex: 2, height: safe().headerBody, flexShrink: 0, backgroundColor: artAvailable ? '#0a173be6' : dark() ? t.dark.glass : '#f8faffb8', backdropFilter: artAvailable ? undefined : 'blur(8px)', borderBottomWidth: 1, borderColor: t.line, paddingHorizontal: 20, paddingTop: 4, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {layout().compact && <Button testID="toggle-navigation" style={button} onPress={() => navigation.set(!navigation())}><Text style={{ color: artAvailable ? t.brand : ink() }}>☰</Text></Button>}
            <Text class="line-clamp-1" style={{ flex: 1, color: artAvailable ? t.brand : ink(), fontSize: t.font, fontWeight: '600' }}>{title()}</Text>
            <Button testID="toggle-details" style={{ padding: 6, flexShrink: 0 }} disabled={windowSize().width < 1100} onPress={() => right.set(!right())}><Text style={{ fontSize: 12, color: artAvailable ? t.goldSoft : muted() }}>{layout().right ? '收起详情 ◫' : '任务详情 ◫'}</Text></Button>
          </View>
          <Text testID="selection" style={{ fontSize: 11, color: artAvailable ? t.sidebarMuted : muted(), alignSelf: 'flex-start', backgroundColor: artAvailable ? '#0a173be6' : undefined }}>{`项目 ${snapshot().projects.find(p => p.id === snapshot().projectId)?.name ?? '—'}`}</Text>
        </View>
        <View testID="chat-body" onLayout={measured('chat-body')} style={{ flex: 1, minHeight: 0, paddingHorizontal: layout().inset, paddingTop: 12, paddingBottom: safe().bottom, gap: 8 }}>
          <Text testID="status" style={{ fontSize: 12, color: muted() }}>{status()}</Text>
          {!!error() && <Text testID="error" style={{ color: t.danger, fontSize: 13, backgroundColor: dark() ? t.dark.assistant : t.paper, padding: 8, borderRadius: 8 }}>{error()}</Text>}
          {!snapshot().current?.rows.length && <View testID="empty-state" style={{ padding: layout().compact ? 14 : 24, gap: 10, flexShrink: 0, backgroundColor: dark() ? t.dark.glass : t.glass, backdropFilter: 'blur(8px)', borderRadius: 14 }}><Text style={{ fontSize: 20, color: ink() }}>从一个真实任务开始</Text><Text style={{ fontSize: t.font, color: muted() }}>选择项目与会话后发送消息。这里只展示 Host 返回的公开文本、工具动作与任务状态；没有预填任务结果。</Text></View>}
          <List testID="messages" onLayout={measured('messages')} onScroll={props.onMessageScroll} each={messageRows()} initialScrollAtEnd maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 48 }} estimatedItemSize={88} contentStyle={{ paddingBottom: 12 }} style={{ flex: 1, minHeight: 0 }}>
            {r => <View testID="message" onLayout={e => { measured('message')(e); measured(`message-${r().role}`)(e); measured(`message-${r().body.startsWith('tool_end') ? 'last-tool' : 'row'}`)(e); }} style={{ paddingVertical: 14, paddingHorizontal: 18, marginBottom: 12, gap: 6, width: 'fit-content', maxWidth: Math.min(680, (windowSize().width - sidebarWidth() - (layout().right ? t.rightWidth : 0) - 2 * layout().inset) * .96), alignSelf: r().role === '你' ? 'flex-end' : 'flex-start', borderRadius: 18, borderBottomLeftRadius: r().role === '你' ? 18 : 7, borderBottomRightRadius: r().role === '你' ? 7 : 18, borderWidth: 1, borderColor: r().role === '你' ? '#c5a4687a' : dark() ? '#d3b47766' : t.line, backgroundColor: r().role === '你' ? (dark() ? t.dark.user : '#e8edf9f2') : r().role === '工具' ? (dark() ? t.dark.glass : '#f8faffd1') : (dark() ? t.dark.assistant : t.paper), boxShadow: r().role === '你' ? t.userShadow : dark() ? '0 4px 16px #00000038' : t.assistantShadow }}>
              <Text style={{ fontSize: 12, fontFamily: t.fontFamily, color: dark() ? '#b7c3dd' : r().role === '工具' ? t.accent : muted() }}>{r().role}</Text>
              <TextView styles={{ root: { color: ink(), fontFamily: t.fontFamily, fontSize: t.font, lineHeight: t.lineHeight } }} markdown={r().body} selectable />
            </View>}
          </List>
          <View testID="composer-safe-area" onLayout={measured('composer-safe-area')} style={{ paddingTop: safe().composerTop, paddingBottom: safe().composerBottom, flexShrink: 0 }}>
          <View testID="composer" onLayout={measured('composer')} style={{ height: safe().composerHeight, flexShrink: 0, paddingHorizontal: safe().composerPaddingX, paddingBottom: safe().composerPaddingBottom, paddingTop: 54, gap: 8, borderRadius: clamp(26, windowSize().width * .02, 34), backgroundColor: t.composerBase, backgroundImage: t.composerGradient, backdropFilter: 'blur(8px) saturate(.88)', boxShadow: t.composerShadow }}>
            <NineSlice testID="composer-frame" name="composer-frame" source={[1800,588]} cuts={[170,120,115,120]} edges={[72,54,52,54]} style={{ top: -20, left: -14, right: -14, bottom: -18, zIndex: 1 }} />
            <Input testID="prompt" onLayout={measured('prompt')} style={{ minHeight: 32, flex: 1, fontFamily: t.fontFamily, fontSize: t.font, backgroundColor: 'transparent', color: t.composerInk, caretColor: t.caret, placeholderColor: t.placeholder }} placeholder="发消息或创建任务（本地模型夹具）" value={draft()} onChange={e => draft.set(e.value)} onSubmit={send} />
            <View testID="composer-actions" onLayout={measured('composer-actions')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text class="line-clamp-1" style={{ flex: 1, fontSize: 11, color: t.placeholder }}>PI SDK · 公开事件</Text>
              <Button testID="stop" onLayout={measured('stop')} style={{ padding: 7, borderRadius: 10, backgroundColor: '#ffffff1f' }} disabled={!snapshot().current?.busy || !snapshot().current?.task || snapshot().current!.stopping} disabledStyle={{ opacity: 0.4 }} onPress={() => void controller.stop()}><Text style={{ color: t.composerInk, fontSize: 12 }}>停止</Text></Button>
              <Button testID="send" onLayout={measured('send')} style={{ padding: 7, borderRadius: 10, backgroundColor: t.accent }} disabled={disabled()} disabledStyle={{ opacity: 0.4 }} onPress={send}><Text style={{ color: '#ffffff', fontSize: 12 }}>发送 ↑</Text></Button>
            </View>
          </View>
          </View>
          <Text testID="art-status" onLayout={measured('art-status')} style={{ flexShrink: 0, fontSize: 11, color: dark() ? t.dark.ink : t.ink, backgroundColor: dark() ? t.dark.details : '#f8fafff0', borderRadius: 6, padding: 4, height: safe().previewHeight, textAlign: 'center' }}>{artAvailable ? '本机授权素材预览 · 合成业务不等于实际任务' : '美术未加载：纯样式回归，不是完整皮肤预览'}</Text>
        </View>
        {!active() && <BottomTrim />}
      </View>
      {layout().right && <View testID="details-panel" style={{ width: t.rightWidth, padding: 20, gap: 18, backgroundColor: dark() ? t.dark.details : '#f2f6fdd1', backdropFilter: 'blur(12px)', borderLeftWidth: 1, borderColor: '#c5a46885' }}>
        <Text style={{ fontSize: 16, color: ink(), fontWeight: '600' }}>任务详情</Text><Text style={{ color: muted(), fontSize: 13 }}>当前会话</Text><Text style={{ color: ink() }}>{title()}</Text><Text style={{ color: muted(), fontSize: 13 }}>{status()}</Text><Text style={{ color: ink(), fontSize: 13 }}>{`任务 ID：${snapshot().current?.task?.id ?? '尚未提交'}`}</Text><Text style={{ fontSize: 12, color: muted() }}>停止响应不等于工具已退出。只有终态且事件排空才能确认本次读取结束。工具过程在对话内按真实顺序展示，此面板不生成思考文本或虚构任务。</Text>
      </View>}
    </View>
  );
}
