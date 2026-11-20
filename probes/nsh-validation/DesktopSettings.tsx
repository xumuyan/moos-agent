import { keymap, Scroll, Text, View, windowSize, type Bounds, type ViewStyle } from 'nsh';
import { Button, Dialog, Radio, RadioGroup, Toggle } from 'nsh/base';
import { DesktopIcon } from './DesktopIcon';
import { desktopTheme as t } from './desktop-theme';
import { controlFocus, controlHover, controlPressed, controlSurface } from './desktop-control-style';

const appearances = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
] as const;
export type DesktopAppearance = typeof appearances[number]['id'];

type SettingsProps = {
  onClose: () => void;
  dark: boolean;
  art: boolean;
  appearance: DesktopAppearance;
  onAppearance: (appearance: DesktopAppearance) => void;
  characters: boolean;
  onCharacters: (show: boolean) => void;
  statistics: boolean;
  onStatistics: (show: boolean) => void;
  defaultModel?: string;
  onLayout?: (event: { bounds: Bounds }) => void;
};

function Preference(props: { id: string; label: string; description: string; checked: boolean; disabled?: boolean;
  color: string; muted: string; onChange: (checked: boolean) => void }) {
  return <Toggle testID={props.id} pressed={props.checked} disabled={props.disabled}
    accessibilityLabel={props.label} onChange={event => props.onChange(event.pressed)}
    hoverStyle={controlHover} focusVisibleStyle={controlFocus}
    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 9 }}>
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
      <Text style={{ fontFamily: t.fontFamily, fontSize: 13, color: props.color }}>{props.label}</Text>
      <Text style={{ fontFamily: t.fontFamily, fontSize: 12, lineHeight: 17, color: props.muted }}>{props.description}</Text>
    </View>
    <View style={{ width: 42, height: 23, borderRadius: 12, padding: 3, justifyContent: 'center', flexShrink: 0,
      alignItems: props.checked ? 'flex-end' : 'flex-start', backgroundColor: props.checked ? '#365891' : '#63759488',
      borderWidth: 1, borderColor: props.checked ? '#c8ab72' : '#8094b580' }}>
      <View style={{ width: 15, height: 15, borderRadius: 8, backgroundColor: props.checked ? '#f2ddb1' : '#e0e8f6' }} />
    </View>
  </Toggle>;
}

export function DesktopSettings(props: SettingsProps) {
  keymap.bind('escape', props.onClose, { when: 'always' });
  const ink = () => props.dark ? '#f4eddd' : '#172b50';
  const muted = () => props.dark ? '#b9c8e3' : '#485d7e';
  const gold = () => props.dark ? '#e5c991' : '#76542b';
  const card = (): ViewStyle => ({ padding: 5, gap: 3, borderRadius: 12, borderWidth: 1,
    backgroundColor: props.dark ? '#101f3eba' : '#f7faffc7', borderColor: props.dark ? '#7c93c04a' : '#8a9dc75c' });

  const width = () => Math.max(0, Math.min(520, windowSize().width - 32));
  const height = () => Math.max(0, Math.min(492, windowSize().height - 52));
  return <Dialog testID="desktop-settings-dialog" accessibilityLabel="设置" animation="none"
    closeOnEscape={false}
    onOpenChange={event => { if (!event.open) props.onClose(); }}
    backdropTestID="settings-backdrop" backdropStyle={{ backgroundColor: '#070f2566' }}
    style={{ position: 'absolute', left: (windowSize().width - width()) / 2, top: (windowSize().height - height()) / 2,
      width: width(), height: height(),
      overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: '#bd9a5a',
      backgroundColor: props.dark ? '#182850' : '#ebf0fa',
      backgroundImage: props.dark ? 'linear-gradient(160deg, #223761, #142447)' : 'linear-gradient(160deg, #f0f4fb, #dbe6f7)',
      boxShadow: '0 16px 52px #060f2b65' }}>
    <View testID="settings-content" onLayout={props.onLayout} style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 20, paddingVertical: 14,
        borderBottomWidth: 1, borderColor: props.dark ? '#cfac6d55' : '#a77b434d' }}>
        <DesktopIcon name="settings" color={gold()} size={19} />
        <Text style={{ fontFamily: t.fontFamily, flex: 1, color: ink(), fontSize: 21, fontWeight: '600' }}>设置</Text>
        <Button testID="settings-close" accessibilityLabel="关闭设置" onPress={props.onClose}
          hoverStyle={controlHover} activeStyle={controlPressed} focusVisibleStyle={controlFocus}
          style={{ ...controlSurface, paddingHorizontal: 12, height: 32, justifyContent: 'center' }}>
          <Text style={{ fontFamily: t.fontFamily, fontSize: 12, color: ink() }}>关闭</Text>
        </Button>
      </View>
      <Scroll testID="settings-scroll" style={{ flex: 1, minHeight: 0 }} contentStyle={{ padding: 20, gap: 13 }}>
        <View style={{ gap: 8 }}>
          <Text style={{ fontFamily: t.fontFamily, color: gold(), fontSize: 14, fontWeight: '600' }}>外观与显示</Text>
          <View style={card()}>
            <View style={{ padding: 10, gap: 7 }}>
              <Text style={{ fontFamily: t.fontFamily, color: ink(), fontSize: 13 }}>界面颜色</Text>
              <RadioGroup style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                {appearances.map(option => <Radio testID={`settings-appearance-${option.id}`} checked={props.appearance === option.id}
                  onChange={() => props.onAppearance(option.id)} hoverStyle={controlHover} focusVisibleStyle={controlFocus}
                  style={{ ...controlSurface, borderWidth: 1, borderColor: 'transparent', minHeight: 32, justifyContent: 'center', paddingHorizontal: 10 }}
                  checkedStyle={{ backgroundColor: props.dark ? '#395689' : '#cdddf5', borderColor: '#c2a272' }}>
                  <Text style={{ fontFamily: t.fontFamily, color: ink(), fontSize: 12 }}>{option.label}</Text>
                </Radio>)}
              </RadioGroup>
            </View>
            <Preference id="settings-characters" label="人物装饰" description={props.art ? '显示工作台两侧及侧栏的人物插画' : '当前预览未加载人物素材'}
              checked={props.art && props.characters} disabled={!props.art} onChange={props.onCharacters} color={ink()} muted={muted()} />
            <Preference id="settings-statistics" label="输入栏会话统计" description="显示轮数、工具步数、缓存命中和上下文"
              checked={props.statistics} onChange={props.onStatistics} color={ink()} muted={muted()} />
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={{ fontFamily: t.fontFamily, color: gold(), fontSize: 14, fontWeight: '600' }}>模型</Text>
          <View style={{ ...card(), padding: 13, gap: 5 }}>
            <Text style={{ fontFamily: t.fontFamily, color: ink(), fontSize: 13 }}>默认模型</Text>
            <Text testID="settings-default-model" class="line-clamp-2" style={{ fontFamily: t.fontFamily, color: muted(), fontSize: 12, lineHeight: 17 }}>{props.defaultModel ?? '暂未提供'}</Text>
            <Text style={{ fontFamily: t.fontFamily, color: muted(), fontSize: 12, lineHeight: 17 }}>在聊天输入栏可为当前会话选择模型和推理等级。</Text>
          </View>
        </View>
        <Text style={{ fontFamily: t.fontFamily, color: muted(), fontSize: 11, lineHeight: 16 }}>显示设置即时生效，仅在本次运行中保留。</Text>
      </Scroll>
    </View>
  </Dialog>;
}
