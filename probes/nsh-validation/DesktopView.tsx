import { cleanup, colorScheme, host, Image, List, signal, Text, View, windowSize, type Bounds, type ScrollEvent } from 'nsh';
import { Button, Input, TextView } from 'nsh/base';
import { DesktopController, type DesktopCall } from './desktop-ui-controller';
import { desktopCall } from './desktop-ui-transport';
import { desktopTheme as t, desktopLayout, styleLayout, clamp, createMessageRows } from './desktop-theme';
import { Art, NineSlice, Wallpaper, TopTrim, BottomTrim, SidebarCorners, artAvailable } from './desktop-theme-layers';
import { liveSidebar } from './desktop-live-sidebar';
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
  const sidebarWidth = () => (!layout().compact || navigation()) ? layout().sidebar : 0;
  return (
    <View testID="desktop-root" style={{ flex: 1, flexDirection: 'row', backgroundColor: dark() ? t.dark.canvas : t.canvas, overflow: 'hidden' }}>
      <Wallpaper sidebar={sidebarWidth()} active={active()} details={layout().right} />
      {(!layout().compact || navigation()) && <View testID="sidebar" style={{ width: layout().sidebar, backgroundColor: sidebarStyle().backgroundColor, backgroundImage: sidebarStyle().backgroundImage, boxShadow: t.sidebarShadow, padding: 16, gap: 10, overflow: 'hidden' }}>
        <SidebarCorners />
        <View testID="sidebar-brand" style={{ ...sidebarStyle().brand, flexDirection: 'row', alignItems: 'center', gap: 10 }}><Image src={brandIcon} style={{ width: 28, height: 28 }} /><Text style={{ fontSize: 20, color: t.brand, fontFamily: t.fontFamily, fontWeight: '600', textShadow: '0 1px 3px #02071980' }}>沐码</Text></View>
        <View style={{ height: 58, marginTop: 4, marginBottom: 8 }}>
          <NineSlice name="new-session" source={[1400,308]} cuts={[0,210,0,210]} edges={[0,layout().compact ? 32 : 40,0,layout().compact ? 32 : 40]} fill style={{ top: 0, left: 0, right: 0, bottom: 0 }} />
          <Button testID="create-session" style={{ height: 58, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' }} disabled={snapshot().loading || !snapshot().projectId} disabledStyle={{ opacity: .4 }} onPress={() => void create()}><Text style={{ fontFamily: t.ornamentFont, fontSize: layout().compact ? 14 : 16, fontWeight: '600', color: artAvailable ? '#152246' : t.goldSoft }}>⊕ 新会话</Text></Button>
        </View>
        <Button testID="search-unavailable" disabled style={{ ...button, borderWidth: 1, borderColor: '#e1cfaa33' }}><Text style={{ color: t.sidebarMuted, fontSize: 12 }}>⌕ 搜索（未接入）</Text></Button>
        <Text style={{ fontSize: 12, color: t.sidebarMuted }}>工作区 / 独立临时项目</Text>
        <List testID="projects" each={snapshot().projects} estimatedItemSize={54} style={{ height: Math.min(snapshot().projects.length * 54, 162), flexShrink: 0 }}>
          {p => <View style={{ height: 54 }}>
            {snapshot().projectId === p().id && <NineSlice name="workspace-ribbon" source={[1185,240]} cuts={[0,145,0,140]} edges={[0,36,0,35]} fill style={{ top: -3, left: -12, right: 0, bottom: -3 }} />}
            <Button testID={`project-${p().name}`} style={{ ...button, height: 54, paddingVertical: 7, paddingLeft: 7, paddingRight: 36, flexDirection: 'row', gap: 8 }} onPress={() => void project(p().id)}>
              {snapshot().projectId === p().id && artAvailable && <View style={{ width: 30, height: 38 }}><Art name="workspace-shield" style={{ top: 0, left: 0, width: 30, height: 38, objectFit: 'contain' }} /></View>}
              <Text testID={`project-label-${p().id}`} onLayout={measured(`project-label-${p().id}`)} class="line-clamp-1" style={{ flex: 1, minWidth: 0, fontSize: t.font, fontFamily: t.ornamentFont, color: '#f4ead5' }}>{`${snapshot().projectId === p().id ? '● ' : '◇ '}${p().name}`}</Text>
            </Button>
          </View>}
        </List>
        <Text testID="selection" class="line-clamp-1" style={{ fontSize: 12, color: t.sidebarMuted }}>{`项目 ${snapshot().projects.find(p => p.id === snapshot().projectId)?.name ?? '—'}`}</Text>
        <List testID="sessions" each={snapshot().sessions} estimatedItemSize={36} style={{ flex: 1 }}>
          {s => <Button testID={`session-${s().title}`} style={{ height: 36, marginHorizontal: 2, paddingLeft: 26, paddingRight: 9, borderRadius: 7, borderWidth: snapshot().sessionId === s().id ? 1 : 0, borderColor: '#e2be70b8', backgroundImage: snapshot().sessionId === s().id ? 'linear-gradient(90deg, #526fb8bd, #2b468b9e 72%, #142a5e80)' : undefined, backgroundColor: 'transparent', boxShadow: snapshot().sessionId === s().id ? 'inset 0 1px #fff4d733, inset 0 -1px #07133747, 0 3px 9px #02081c4d' : undefined }} onPress={() => session(s().id)}>
            {snapshot().sessionId === s().id && <View style={{ position: 'absolute', pointerEvents: 'none', left: 5, top: 7, bottom: 7, width: 3, borderRadius: 999, backgroundImage: 'linear-gradient(#fff0c5, #d4a951)', boxShadow: '0 0 5px #e7c780b8' }} />}
            <Text class="line-clamp-1" style={{ fontSize: 13, fontFamily: t.ornamentFont, color: snapshot().sessionId === s().id ? '#fff8e8' : '#d7c8a8' }}>{`${snapshot().sessionId === s().id ? '● ' : ''}${s().title}`}</Text>
          </Button>}
        </List>
        <Art name="chibi" style={{ left: layout().sidebar * .52 - Math.min(320, layout().sidebar * .82) / 2, bottom: 166, width: Math.min(320, layout().sidebar * .82), height: Math.min(260, windowSize().height * .38), objectFit: 'contain', objectPosition: 'center bottom', opacity: .22, filter: 'brightness(1.08) contrast(1.04)' }} />
        <View testID="sidebar-footer" style={{ minHeight: 154, paddingTop: 74, paddingHorizontal: 2, paddingBottom: 6, gap: 8 }}>
          <Art name="sidebar-swag" style={{ top: 0, left: -16, right: -16, height: 72, objectFit: 'fill' }} />
          <View style={{ height: 34 }}><Art name="settings-frame" style={{ top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: 34, objectFit: 'fill' }} /><Button testID="settings-unavailable" disabled style={{ height: 34, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: t.sidebarMuted, fontSize: 12 }}>设置（未接入）</Text></Button></View>
          <Text style={{ fontSize: 11, color: t.sidebarMuted }}>NSH 0.5.0 · 独立验证</Text>
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
          <Text style={{ fontSize: 11, color: artAvailable ? t.sidebarMuted : muted(), alignSelf: 'flex-start', backgroundColor: artAvailable ? '#0a173be6' : undefined }}>对话  /  公开工具过程 · 本地模型夹具 · 非正式应用</Text>
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
