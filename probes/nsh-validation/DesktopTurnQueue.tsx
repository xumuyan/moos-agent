import { computed, Scroll, signal, Text, View, type Bounds } from 'nsh';
import { Button, Input, Tooltip } from 'nsh/base';
import { DesktopIcon } from './DesktopIcon';
import { controlFocus, controlHover, controlPressed } from './desktop-control-style';
import { validTurnText, type QueuedTurn } from './desktop-turn-queue';

const focus = { hoverStyle: controlHover, activeStyle: controlPressed, focusVisibleStyle: controlFocus };
type Edit = { id: number; text: string };
export function DesktopTurnQueue(props: {
  scope: string; rows: readonly QueuedTurn[]; edit: Edit | null; status: string; canResume: boolean;
  dark: boolean; ink: string; muted: string; font: string;
  onEdit: (edit: Edit | null) => void; onSave: () => void; onRemove: (id: number) => void; onResume: () => void;
  onLayout: (event: { bounds: Bounds }) => void;
}) {
  const expanded = signal('');
  const multiple = computed(() => props.rows.length > 1);
  const editingId = computed(() => props.edit?.id);
  const visible = computed(() => !multiple() || expanded() === props.scope || editingId() !== undefined);
  const actionStyle = { width: 28, height: 28, borderRadius: 8, flexShrink: 0, alignItems: 'center', justifyContent: 'center' } as const;
  const action = (id: string, label: string, icon: 'edit' | 'trash' | 'toolDone', onPress: () => void, disabled = () => false) =>
    <Button testID={id} accessibilityLabel={label} style={actionStyle} {...focus} onPress={onPress} disabled={disabled()} disabledStyle={{ opacity: .48 }}
      tooltip={<Tooltip delay={500} style={{ backgroundColor: '#29292b', borderRadius: 8, padding: 8 }}>
        <Text style={{ fontFamily: props.font, color: '#fffaf0', fontSize: 12 }}>{label}</Text>
      </Tooltip>}>
      <DesktopIcon name={icon} size={14} color={props.muted} />
    </Button>;
  return <View testID="turn-queue" onLayout={props.onLayout} style={{ flexShrink: 0, marginHorizontal: 10,
    borderRadius: 12, borderBottomLeftRadius: 5, borderBottomRightRadius: 5, borderWidth: 1,
    backgroundColor: props.dark ? '#17233feb' : '#e2e9f7f2', borderColor: props.dark ? '#7f9bd438' : '#6582bd4d' }}>
    {!!props.status && <View style={{ height: 30, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 6 }}>
      <Text testID="queue-status" class="line-clamp-1" style={{ flex: 1, minWidth: 0, fontFamily: props.font, color: props.muted, fontSize: 12 }}>{props.status}</Text>
      {props.canResume && <Button testID="queue-resume" accessibilityLabel="继续发送排队消息" onPress={props.onResume} {...focus}
        style={{ borderRadius: 8, flexShrink: 0, paddingHorizontal: 7, height: 26, justifyContent: 'center' }}>
        <Text style={{ fontFamily: props.font, color: props.ink, fontSize: 12 }}>继续发送</Text>
      </Button>}
    </View>}
    {multiple() && <Button testID="queue-toggle" accessibilityLabel={visible() ? '收起排队消息' : '展开排队消息'} onPress={() => expanded.set(visible() ? '' : props.scope)}
      disabled={editingId() !== undefined} {...focus} style={{ height: 30, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8 }}>
      <DesktopIcon name="queue" size={14} color={props.muted} />
      <Text testID="queue-count" style={{ flex: 1, color: props.ink, fontSize: 12, fontFamily: props.font }}>{props.rows.length} 条排队消息</Text>
      <DesktopIcon name={visible() ? 'chevronUp' : 'chevronDown'} size={14} color={props.muted} />
    </Button>}
    {visible() && <Scroll testID="queued-turns" style={{ height: Math.min(props.rows.length, 3) * 36, flexShrink: 0 }}>
      {props.rows.map((row, index) => <View testID={`queued-row-${row.id}`} hoverStyle={controlHover} style={{ height: 36,
        paddingLeft: 10, paddingRight: 4, gap: 6, flexDirection: 'row', alignItems: 'center', borderRadius: 8,
        borderTopWidth: index ? 1 : 0, borderColor: props.dark ? '#7f9bd425' : '#6582bd2c' }}>
        <DesktopIcon name="queue" size={14} color={props.muted} />
        {editingId() === row.id ? <>
          <Input testID="queued-edit-input" accessibilityLabel="编辑排队消息" autoFocus multiline submitBehavior="newline"
            maxLength={4096} autoCapitalize="none" autoCorrect={false} value={props.edit?.text ?? ''} onChange={e => props.onEdit({ id: row.id, text: e.value })}
            style={{ flex: 1, minWidth: 0, height: 32, paddingHorizontal: 5, borderRadius: 6, fontSize: 13, fontFamily: props.font,
              backgroundColor: props.dark ? '#0d162b' : '#f7f9ff', color: props.ink }} />
          {action('queued-save', '保存排队消息', 'toolDone', props.onSave, () => !validTurnText(props.edit?.text ?? ''))}
          <Button testID="queued-cancel-edit" accessibilityLabel="取消编辑" onPress={() => props.onEdit(null)} style={actionStyle} {...focus}>
            <Text style={{ fontFamily: props.font, color: props.muted, fontSize: 16 }}>×</Text>
          </Button>
        </> : <>
          <Text testID={`queued-text-${row.id}`} class="line-clamp-1" style={{ flex: 1, minWidth: 0, fontFamily: props.font,
            fontSize: 13, lineHeight: 18, color: props.ink }}>{row.text.replace(/\s+/g, ' ')}</Text>
          {action(`queued-edit-${row.id}`, '编辑排队消息', 'edit', () => props.onEdit({ id: row.id, text: row.text }))}
          {action(`queued-remove-${row.id}`, '移除排队消息', 'trash', () => props.onRemove(row.id))}
        </>}
      </View>)}
    </Scroll>}
  </View>;
}
