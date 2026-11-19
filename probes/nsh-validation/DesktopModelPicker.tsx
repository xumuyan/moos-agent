import { computed, effect, Scroll, signal, Text, View, windowSize, type Bounds, type InputRef, type ScrollRef } from 'nsh';
import { Button, Input, Popover } from 'nsh/base';
import type { DesktopModel } from './desktop-contract';
import { defaultChoice, modelGroups, type ModelChoice } from './desktop-model-picker';
import { DesktopIcon } from './DesktopIcon';
import { controlFocus, controlHover, controlPressed, controlSurface } from './desktop-control-style';
import { desktopTheme as t } from './desktop-theme';

type Pane = 'root' | 'models' | 'effort';
export function DesktopModelPicker(props: { scope: string; models: DesktopModel[]; choice?: ModelChoice;
  disabled: boolean; dark: boolean; art: boolean; onChange: (choice: ModelChoice) => void;
  onLayout?: (event: { bounds: Bounds }) => void; onPopupLayout?: (event: { bounds: Bounds }) => void }) {
  const opened = signal<string | null>(null), pane = signal<Pane>('root'), query = signal('');
  let searchField: InputRef | undefined, scrollList: ScrollRef | undefined;
  const open = () => !props.disabled && opened() === props.scope;
  const model = () => props.models.find(m => m.id === props.choice?.modelId);
  const modelLabel = () => model()?.label ?? '模型不可选';
  const levels = () => model()?.reasoning?.levels ?? [];
  const effortLabel = () => levels().find(e => e.id === props.choice?.reasoningEffort)?.label;
  const searchable = () => props.models.length > 4;
  const groups = computed(() => modelGroups(props.models, searchable() ? query() : ''));
  function changeQuery(value: string) {
    query.set(value);
    scrollList?.scrollTo({ y: 0, animated: false });
  }
  const menuColor = () => props.dark ? '#e7ecf7' : '#26374e';
  const menuMuted = () => props.dark ? '#bfcae0' : '#4a596e';
  const hover = () => props.dark ? '#c1cbf521' : '#566b9a22';
  const maxHeight = () => Math.min(360, Math.max(110, windowSize().height - 190));
  const row = { height: 34, borderRadius: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 6, flexShrink: 0, backgroundColor: 'transparent' } as const;
  const label = () => ({ fontFamily: t.fontFamily, fontSize: 13, color: menuColor() });
  const close = () => { opened.set(null); query.set(''); pane.set('root'); };
  effect(() => { if (props.disabled || (opened() !== null && opened() !== props.scope)) close(); });
  function select(choice: ModelChoice) { if (open()) { props.onChange(choice); close(); } }
  function selectModel(m: DesktopModel) { select(props.choice?.modelId === m.id ? props.choice : defaultChoice(m)); }
  function rootRow(id: Pane, title: string, value: string | undefined) {
    return <Button testID={`model-menu-${id}`} role="menuitem" accessibilityLabel={`${title}：${value ?? ''}`}
      style={row} hoverStyle={{ backgroundColor: hover() }} onPress={() => { if (open()) pane.set(id); }}>
      <Text style={label()}>{title}</Text>
      <Text class="line-clamp-1" style={{ ...label(), color: menuMuted(), flex: 1, minWidth: 0, textAlign: 'right' }}>{value}</Text>
      <DesktopIcon name="chevronRight" size={14} color={menuMuted()} testID={`icon-model-${id}`} />
    </Button>;
  }
  function option(id: string, name: string, selected: boolean, choose: () => void) {
    return <Button testID={id} role="menuitemradio" accessibilityLabel={name} selected={selected}
      style={row} hoverStyle={{ backgroundColor: hover() }} focusVisibleStyle={{ backgroundColor: hover() }} onPress={choose}>
      <Text class="line-clamp-1" style={{ ...label(), flex: 1, minWidth: 0 }}>{name}</Text>
      {selected && <Text testID={`${id}-check`} style={{ color: menuColor(), width: 14, fontSize: 13 }}>✓</Text>}
    </Button>;
  }
  const triggerInk = () => props.art && !props.dark ? '#bdcdea' : t.composerInk;
  return <Popover testID="model-picker" onLayout={props.onLayout} open={open()} placement="top" align="end" offset={8} margin={12}
    style={{ flexShrink: 1, minWidth: 0, maxWidth: Math.min(240, windowSize().width * .38) }}
    onPosition={props.onPopupLayout}
    onOpenChange={({ open: next, reason }) => {
      if (!next && reason === 'cancel' && open() && pane() !== 'root') { query.set(''); pane.set('root'); return; }
      close(); if (next && !props.disabled) opened.set(props.scope);
    }}
    popupStyle={{ width: Math.min(240, windowSize().width - 24), maxHeight: maxHeight(), padding: 4, borderRadius: 11,
      borderWidth: 1, borderColor: props.dark ? '#798ab47a' : '#acb9d5b8', backgroundColor: props.dark ? '#233250ef' : '#d8e0f0f2',
      backgroundImage: props.dark ? 'linear-gradient(165deg, #374968, #222e48)' : 'linear-gradient(165deg, #e6ebf8f5, #aab5cce8)',
      backdropFilter: 'blur(12px)', boxShadow: '0 6px 24px #0b15384d' }}
    trigger={<Button testID="model-trigger" accessibilityLabel={`选择模型，当前 ${modelLabel()}${effortLabel() ? `，推理等级 ${effortLabel()}` : ''}`}
      selected={open()} disabled={props.disabled} disabledStyle={{ opacity: .54 }}
      style={{ height: 32, minWidth: 0, paddingLeft: 8, paddingRight: 5, gap: 4, ...controlSurface, flexDirection: 'row', alignItems: 'center' }}
      hoverStyle={controlHover} selectedStyle={controlHover} activeStyle={controlPressed} focusVisibleStyle={controlFocus}>
      <Text testID="selected-model" class="line-clamp-1" style={{ flexShrink: 1, minWidth: 0, fontFamily: props.art ? t.ornamentFont : t.fontFamily, fontSize: 12, fontWeight: '600', color: triggerInk() }}>{modelLabel()}</Text>
      {!!effortLabel() && <Text testID="selected-effort" class="line-clamp-1" style={{ minWidth: 0, flexShrink: 1, maxWidth: 64, fontFamily: t.fontFamily, fontSize: 11, fontWeight: '600', color: props.dark ? '#e1c17d' : t.goldSoft }}>{`· ${effortLabel()}`}</Text>}
      {!!props.models.length && <DesktopIcon name={open() ? 'chevronUp' : 'chevronDown'} size={14} color={triggerInk()} testID={open() ? 'icon-model-up' : 'icon-model-down'} />}
    </Button>}>
    <View testID={`model-pane-${pane()}`} role="menu" accessibilityLabel="模型与推理等级" style={{ minHeight: 0 }}>
      {pane() === 'root' && <>
        {rootRow('models', '模型', modelLabel())}
        {!!levels().length && rootRow('effort', '推理等级', effortLabel())}
      </>}
      {pane() === 'models' && <>
        {searchable() && <View style={{ height: 28, flexShrink: 0, flexDirection: 'row', alignItems: 'center' }}>
          <Input ref={node => { searchField = node; }} testID="model-search" accessibilityLabel="搜索模型" placeholder="搜索模型…" autoFocus autoCapitalize="none" autoCorrect={false} maxLength={80} submitBehavior="submit"
            value={query()} onChange={e => changeQuery(e.value)}
            onSubmit={() => { const first = groups()[0]?.models[0]; if (first) selectModel(first); }}
            style={{ flex: 1, minWidth: 0, height: 28, paddingHorizontal: 7, color: menuColor(), backgroundColor: 'transparent', placeholderColor: menuMuted(), fontSize: 12 }} />
          <Button testID="model-search-clear" accessibilityLabel="清除搜索" disabled={!query()} disabledStyle={{ opacity: 0 }}
            onPress={() => { changeQuery(''); searchField?.focus(); }} style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}><Text style={label()}>×</Text></Button>
        </View>}
        <Scroll ref={node => { scrollList = node; }} testID="model-groups" style={{ maxHeight: maxHeight() - (searchable() ? 38 : 10), minHeight: 0 }}>
          {groups().map(group => <View accessibilityLabel={group.label || undefined}>
            {!!group.label && <Text role="header" style={{ paddingHorizontal: 7, height: 23, paddingTop: 4, fontSize: 11, color: menuMuted() }}>{group.label}</Text>}
            {group.models.map(m => option(`model-${m.id}`, m.label, props.choice?.modelId === m.id, () => selectModel(m)))}
          </View>)}
          {!groups().length && <Text testID="model-no-results" style={{ ...label(), padding: 8 }}>没有匹配的模型。</Text>}
        </Scroll>
      </>}
      {pane() === 'effort' && <Scroll style={{ maxHeight: maxHeight() - 10, minHeight: 0 }}>
        {levels().map(e => option(`effort-${e.id}`, e.label, e.id === props.choice?.reasoningEffort, () => {
          const current = model(); if (current) select({ modelId: current.id, reasoningEffort: e.id });
        }))}
      </Scroll>}
    </View>
  </Popover>;
}
