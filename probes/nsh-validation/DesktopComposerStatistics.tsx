import { effect, signal, Text, View, type Bounds } from 'nsh';
import { Button, Popover } from 'nsh/base';
import { DesktopIcon } from './DesktopIcon';
import { controlFocus, controlHover, controlPressed, controlSurface } from './desktop-control-style';
import { desktopTheme as t } from './desktop-theme';
import { showContext, showCount, showRate, showTime, type ComposerStatistics } from './desktop-composer-statistics';

type LayoutEvent = { bounds: Bounds };
export function DesktopComposerStatistics(props: { scope: string; data: ComposerStatistics; dark: boolean; art: boolean;
  height: number; onLayout?: (e: LayoutEvent) => void; onTriggerLayout?: (e: LayoutEvent) => void; onPopupLayout?: (e: LayoutEvent) => void }) {
  const opened = signal<string | null>(null);
  const open = () => !!props.scope && opened() === props.scope;
  effect(() => { if (opened() !== props.scope) opened.set(null); });
  const ink = () => props.dark ? '#d7e1f6' : '#293956';
  const line = () => props.dark ? '#8da8dd45' : '#879cc966';
  const label = () => ({ fontFamily: t.fontFamily, fontSize: 12, color: ink() });
  const roundSteps = () => `${showCount(props.data.rounds)} 轮 ${showCount(props.data.toolSteps)} 步`;
  const timing = (id: string, name: string, ms: number | null) =>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 24 }}>
      <Text style={label()}>{name}</Text><Text testID={id} style={{ ...label(), fontWeight: '600' }}>{showTime(ms)}</Text>
    </View>;
  return <View testID="composer-statistics" onLayout={props.onLayout} style={{ flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', flexShrink: 0, minWidth: 0, height: props.height, gap: 10, paddingHorizontal: 6,
    backgroundColor: props.dark ? '#0b1737e6' : props.art ? '#e7eef9e6' : '#f8fafff0', borderRadius: 8 }}>
    <Popover testID="round-statistics" onLayout={props.onTriggerLayout} open={open()} placement="top" align="start" offset={8} margin={12}
      onPosition={props.onPopupLayout} onOpenChange={({ open: next }) => opened.set(next && props.scope ? props.scope : null)}
      popupStyle={{ width: 280, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: line(),
        backgroundColor: props.dark ? '#182747' : '#ecf1fb', boxShadow: '0 6px 24px #0b15384d' }}
      trigger={<Button testID="statistics-trigger" accessibilityLabel={`会话统计，${roundSteps()}`}
        disabled={!props.scope} selected={open()} style={{ ...controlSurface, height: 24, flexDirection: 'row',
          alignItems: 'center', paddingHorizontal: 8, gap: 5, backgroundColor: props.dark ? '#8da8dd26' : '#879cc930' }}
        hoverStyle={controlHover} selectedStyle={controlHover} activeStyle={controlPressed} focusVisibleStyle={controlFocus}>
        <DesktopIcon name="gauge" size={13} color={ink()} />
        <Text testID="statistics-rounds" style={label()}>{roundSteps()}</Text>
      </Button>}>
      <View testID="statistics-timing" accessibilityLabel="会话统计">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 8,
          marginBottom: 4, borderBottomWidth: 1, borderColor: line() }}>
          <DesktopIcon name="gauge" size={13} color={ink()} />
          <Text style={{ ...label(), flex: 1, fontWeight: '600' }}>会话统计</Text>
          <Text style={{ ...label(), fontWeight: '600' }}>{roundSteps()}</Text>
        </View>
        {timing('statistics-model-ms', '模型用时', null)}
        {timing('statistics-ttft', '首 token 平均（TTFT）', null)}
        {timing('statistics-elapsed', '最近一轮执行用时', props.data.elapsedMs)}
        {timing('statistics-tool-ms', '最近一轮工具用时合计', props.data.toolMs)}
      </View>
    </Popover>
    <Text testID="statistics-cache" class="line-clamp-1" style={{ ...label(), flexShrink: 1, minWidth: 0 }}>{`缓存命中 ${showRate(props.data.cacheHitRate)}`}</Text>
    <Text testID="statistics-context" class="line-clamp-1" style={{ ...label(), minWidth: 0, flexShrink: 1 }}>{`上下文 ${showContext(props.data.context)}`}</Text>
  </View>;
}
