import { cleanup, effect, Image, Scroll, signal, Text, View } from 'nsh';
import { Button } from 'nsh/base';
import type { Calls, ImportedAsset, ImportedPage, ImportedRequest } from './desktop-contract';
import { controlSurface, controlHover, controlFocus } from './desktop-control-style';
import { desktopTheme as t } from './desktop-theme';

export async function openHistoryAsset(load: (request: ImportedRequest) => Promise<Calls['sessions.manage']['result']>,
  scope: { projectId: string; sessionId: string }, asset: ImportedAsset, current: () => boolean) {
  const request = { ...scope, action: 'importedAsset' as const, assetId: asset.id };
  const isImage = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(asset.mime) && asset.bytes < 16 * 1024 * 1024;
  if (!isImage) { await load({ ...request, offset: 0, reveal: true }); return null; }
  const parts: ArrayBuffer[] = [];
  for (let offset = 0; offset < asset.bytes;) {
    const { asset: chunk } = await load({ ...request, offset, reveal: false });
    if (!current()) return null;
    const bytes = Uint8Array.from(atob(chunk?.data ?? ''), char => char.charCodeAt(0));
    if (!bytes.length || offset + bytes.length > asset.bytes) throw Error('invalid');
    parts.push(bytes.buffer);
    offset += bytes.length;
    if (Boolean(chunk?.end) !== (offset === asset.bytes)) throw Error('invalid');
  }
  return URL.createObjectURL(new Blob(parts, { type: asset.mime }));
}

export function DesktopImportedHistory(props: { dark: boolean; projectId: string; sessionId: string;
  load: (request: ImportedRequest) => Promise<Calls['sessions.manage']['result']> }) {
  const page = signal<ImportedPage | null>(null);
  const busy = signal(true), error = signal(''), cursors = signal<(number | null)[]>([null]);
  const image = signal<string | null>(null);
  let edition = 0, selection = 0, imageEdition = 0, disposed = false;
  let imageURL: string | null = null;
  const closeImage = () => {
    imageEdition++;
    if (imageURL) URL.revokeObjectURL(imageURL);
    imageURL = null;
    image.set(null);
  };
  cleanup(() => { disposed = true; closeImage(); });
  const ink = () => ({ fontFamily: t.fontFamily, color: props.dark ? t.dark.ink : t.ink, fontSize: 13 });
  const button = (label: string, action: () => void, id?: string, disabled = false) => <Button testID={id}
    accessibilityLabel={label} onPress={action} disabled={disabled} disabledStyle={{ opacity: .4 }}
    style={{ ...controlSurface, paddingHorizontal: 9, paddingVertical: 7, alignSelf: 'flex-start' }} hoverStyle={controlHover} focusVisibleStyle={controlFocus}>
    <Text style={ink()}>{label}</Text></Button>;
  const messageDate = (date: string) => date.slice(0, 10) + ' ' + date.slice(11, 16) + ' UTC';
  async function fetchPage(sessionId: string, history: (number | null)[]) {
    const version = ++edition;
    closeImage(); busy.set(true); error.set('');
    try {
      const result = await props.load({ action: 'importedPage', projectId: props.projectId, sessionId, before: history.at(-1) ?? null });
      if (!result.importedPage) throw Error('missing');
      if (!disposed && version === edition) { cursors.set(history); page.set(result.importedPage); }
    } catch { if (!disposed && version === edition) error.set('无法读取该页聊天记录'); }
    finally { if (!disposed && version === edition) busy.set(false); }
  }
  async function viewAsset(sessionId: string, asset: ImportedAsset) {
    closeImage(); error.set('');
    const version = imageEdition;
    const current = () => !disposed && version === imageEdition;
    try {
      const url = await openHistoryAsset(props.load, { projectId: props.projectId, sessionId }, asset, current);
      if (url && current()) { imageURL = url; image.set(url); }
      else if (url) URL.revokeObjectURL(url);
    } catch { if (current()) error.set('无法读取该附件'); }
  }
  effect(() => {
    const { sessionId } = props;
    const version = ++selection;
    // Host dispatch can read other signals. Track only the selected session here.
    void Promise.resolve().then(() => {
      if (disposed || version !== selection) return;
      page.set(null);
      return fetchPage(sessionId, [null]);
    });
  });
  return <View testID="imported-history" style={{ flex: 1, minHeight: 0, gap: 10, paddingVertical: 8 }}>
    {busy() && <Text style={ink()}>正在读取…</Text>}
    {!!error() && <Text style={ink()}>{error()}</Text>}
    {image() ? <>
      {button('返回聊天记录', closeImage, 'imported-close-image')}
      <Image src={image()!} style={{ flex: 1, width: '100%', objectFit: 'contain' }} />
    </> : page() ? <>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
        <Text style={{ ...ink(), fontSize: 12 }}>原工作区 {page()!.session.workspace} · 历史记录{page()!.session.archived ? ' · 已归档' : ''}</Text>
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
    </> : null}
  </View>;
}
