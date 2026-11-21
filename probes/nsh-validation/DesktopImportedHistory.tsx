import { cleanup, Image, Scroll, signal, Text, View, windowSize } from 'nsh';
import { Button, Dialog, Input } from 'nsh/base';
import type { Calls, ImportedAsset, ImportedPage, ImportedRequest, ImportedSession } from './desktop-contract';
import { controlSurface, controlHover, controlFocus } from './desktop-control-style';
import { desktopTheme as t } from './desktop-theme';

export function DesktopImportedHistory(props: { dark: boolean; close: () => void;
  load: (request: ImportedRequest) => Promise<Calls['sessions.manage']['result']> }) {
  const sessions = signal<ImportedSession[]>([]), page = signal<ImportedPage | null>(null), query = signal('');
  const busy = signal(true), error = signal(''), cursors = signal<(number | null)[]>([null]);
  const image = signal<string | null>(null);
  let edition = 0, imageEdition = 0, disposed = false;
  const closeImage = () => {
    imageEdition++;
    if (image()) URL.revokeObjectURL(image()!);
    image.set(null);
  };
  cleanup(() => { disposed = true; closeImage(); });
  const ink = () => ({ fontFamily: t.fontFamily, color: props.dark ? t.dark.ink : t.ink, fontSize: 13 });
  const match = (item: ImportedSession) => (item.workspace + ' ' + item.title).toLowerCase().includes(query().trim().toLowerCase());
  const button = (label: string, action: () => void, id?: string, disabled = false) => <Button testID={id}
    accessibilityLabel={label} onPress={action} disabled={disabled} disabledStyle={{ opacity: .4 }}
    style={{ ...controlSurface, paddingHorizontal: 9, paddingVertical: 7, alignSelf: 'flex-start' }} hoverStyle={controlHover} focusVisibleStyle={controlFocus}>
    <Text style={ink()}>{label}</Text></Button>;
  const messageDate = (date: string) => date.slice(0, 10) + ' ' + date.slice(11, 16) + ' UTC';
  async function list() {
    edition++; closeImage(); page.set(null); busy.set(true); error.set('');
    const version = edition;
    try {
      const result = await props.load({ action: 'importedList' });
      if (!disposed && version === edition) sessions.set(result.imported ?? []);
    } catch { if (!disposed && version === edition) error.set('无法读取导入的会话'); }
    finally { if (!disposed && version === edition) busy.set(false); }
  }
  async function fetchPage(sessionId: string, history: (number | null)[]) {
    const version = ++edition;
    closeImage(); busy.set(true); error.set('');
    try {
      const result = await props.load({ action: 'importedPage', sessionId, before: history.at(-1) ?? null });
      if (!result.importedPage) throw Error('missing');
      if (!disposed && version === edition) { cursors.set(history); page.set(result.importedPage); }
    } catch { if (!disposed && version === edition) error.set('无法读取该页聊天记录'); }
    finally { if (!disposed && version === edition) busy.set(false); }
  }
  async function viewAsset(sessionId: string, asset: ImportedAsset) {
    closeImage(); error.set('');
    const version = imageEdition;
    const isImage = ['image/png','image/jpeg','image/jpg','image/gif','image/webp'].includes(asset.mime) && asset.bytes < 16 * 1024 * 1024;
    try {
      if (!isImage) { await props.load({ action: 'importedAsset', sessionId, assetId: asset.id, offset: 0, reveal: true }); return; }
      const parts: ArrayBuffer[] = [];
      for (let offset = 0; offset < asset.bytes;) {
        const { asset: chunk } = await props.load({ action: 'importedAsset', sessionId, assetId: asset.id, offset, reveal: false });
        if (disposed || version !== imageEdition) return;
        const bytes = Uint8Array.from(atob(chunk?.data ?? ''), char => char.charCodeAt(0));
        if (!bytes.length || offset + bytes.length > asset.bytes) throw Error('invalid');
        parts.push(bytes.buffer);
        offset += bytes.length;
        if (Boolean(chunk?.end) !== (offset === asset.bytes)) throw Error('invalid');
      }
      image.set(URL.createObjectURL(new Blob(parts, { type: asset.mime })));
    } catch { if (!disposed && version === imageEdition) error.set('无法读取该附件'); }
  }
  void list();
  const width = () => Math.max(0, Math.min(900, windowSize().width - 36));
  const height = () => Math.max(0, windowSize().height - 80);
  return <Dialog testID="imported-history" accessibilityLabel="正式聊天记录" animation="none"
    onOpenChange={event => { if (!event.open) props.close(); }}
    backdropStyle={{ backgroundColor: '#070f2566' }}
    style={{ position: 'absolute', top: 40, left: (windowSize().width - width()) / 2, width: width(), height: height(),
      gap: 10, padding: 16, borderRadius: 15, borderWidth: 1, borderColor: '#bd9a5a',
      backgroundColor: props.dark ? '#182850' : '#ebf0fa' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {page() && button('返回会话列表', () => void list(), 'imported-back')}
      <Text class="line-clamp-1" style={{ ...ink(), flex: 1, fontSize: 17, fontWeight: '600' }}>{page()?.session.title || '正式聊天记录'}</Text>
      {button('关闭', props.close, 'imported-close')}
    </View>
    {busy() && <Text style={ink()}>正在读取…</Text>}
    {!!error() && <Text style={ink()}>{error()}</Text>}
    {image() ? <>
      {button('返回聊天记录', closeImage, 'imported-close-image')}
      <Image src={image()!} style={{ flex: 1, width: '100%', objectFit: 'contain' }} />
    </> : page() ? <>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
        <Text style={{ ...ink(), fontSize: 12 }}>{page()!.session.workspace} · {page()!.session.origin}{page()!.session.archived ? ' · 已归档' : ''}</Text>
        {!!page()!.session.linked && button(page()!.session.origin === 'DSH' ? '关联的 PI 记录' : '原会话', () => void fetchPage(page()!.session.linked!, [null]))}
        {button('更早', () => void fetchPage(page()!.session.id, [...cursors(), page()!.before]), 'imported-older', busy() || !page()!.before)}
        {button('更晚', () => void fetchPage(page()!.session.id, cursors().slice(0, -1)), 'imported-newer', busy() || cursors().length < 2)}
      </View>
      <Scroll testID="imported-messages" style={{ flex: 1, minHeight: 0 }} contentStyle={{ gap: 8 }}>
        {!page()!.items.length && <Text style={ink()}>这个会话没有消息</Text>}
        {page()!.items.map(item => <View style={{ gap: 5, padding: 10, borderRadius: 9, backgroundColor: props.dark ? '#263858' : '#f8faff' }}>
          <Text style={{ ...ink(), opacity: .75, fontSize: 11 }}>
            {item.role === 'user' ? '你' : item.role === 'assistant' ? '助手' : item.role}{item.continuation ? ' · 续' : ''} · {messageDate(item.date)}
          </Text>
          {!!item.body && <View selectable><Text style={{ ...ink(), lineHeight: 20 }}>{item.body}</Text></View>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {item.assets.map(asset => button(asset.bytes ? asset.name : asset.name + '（文件缺失）',
              () => void viewAsset(page()!.session.id, asset), `imported-asset-${asset.id}`, !asset.bytes))}
          </View>
        </View>)}
      </Scroll>
    </> : <>
      <Input testID="imported-search" accessibilityLabel="搜索会话或工作区" placeholder="搜索会话或工作区"
        value={query()} onChange={event => query.set(event.value)} style={{ ...controlSurface, ...ink(), height: 34, paddingHorizontal: 8 }} />
      <Scroll testID="imported-sessions" style={{ flex: 1, minHeight: 0 }} contentStyle={{ gap: 4 }}>
        {sessions().filter(match).map(item => <Button testID={`imported-session-${item.id}`}
          style={{ ...controlSurface, padding: 8, gap: 4 }} hoverStyle={controlHover} onPress={() => void fetchPage(item.id, [null])}>
          <Text style={ink()}>{item.title}</Text>
          <Text style={{ ...ink(), fontSize: 11, opacity: .74 }}>
            {item.workspace} · {item.messages} 条消息{item.archived ? ' · 已归档' : ''} · {item.updated.slice(0, 10)}
          </Text>
        </Button>)}
      </Scroll>
    </>}
  </Dialog>;
}
