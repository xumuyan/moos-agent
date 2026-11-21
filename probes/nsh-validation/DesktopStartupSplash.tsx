import { cleanup, createMotion, Image, keymap, reduceMotion, signal, Text, Video, View } from 'nsh';
import { Button } from 'nsh/base';
import brandIcon from './assets/desktop/sidebar-icon.png';
import { desktopTheme as t } from './desktop-theme';

export function DesktopStartupSplash(props: { clips: readonly string[] }) {
  const playlist = [...props.clips];
  for (let index = playlist.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [playlist[index], playlist[other]] = [playlist[other], playlist[index]];
  }
  const phase = signal<'playing' | 'fading' | 'closed'>(reduceMotion() ? 'closed' : 'playing');
  const active = signal(0), loaded = signal(false), curtainVisible = signal(true);
  const reveal = createMotion({ initial: { opacity: 1 } });
  const fade = createMotion({ initial: { opacity: 1 } });
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let fadeDeadline: ReturnType<typeof setTimeout> | undefined;
  let unbindEscape: (() => void) | undefined;
  let disposed = false;
  const close = () => {
    if (phase() !== 'playing') return;
    if (watchdog !== undefined) clearTimeout(watchdog);
    unbindEscape?.();
    reveal.stop();
    phase.set('fading');
    // Keep a bounded removal path independent of the native animation callback.
    fadeDeadline = setTimeout(() => phase.set('closed'), 380);
    void fade.play({ keyframes: { opacity: [1, 0] }, duration: 280, easing: 'easeOut' })
      .catch(() => {}).finally(() => {
        if (fadeDeadline !== undefined) clearTimeout(fadeDeadline);
        if (!disposed) phase.set('closed');
      });
  };
  function revealContent(index: number) {
    if (phase() !== 'playing' || index !== active() || loaded()) return;
    loaded.set(true);
    void reveal.play({ keyframes: { opacity: [1, 0] }, duration: 360, easing: 'easeOut' })
      .catch(() => {}).finally(() => {
        if (!disposed && phase() === 'playing' && index === active()) curtainVisible.set(false);
      });
  }
  function failed(index: number) {
    if (phase() !== 'playing' || index !== active()) return;
    if (index + 1 >= playlist.length) {
      close();
      return;
    }
    reveal.reset();
    curtainVisible.set(true);
    loaded.set(false);
    active.set(index + 1);
  }
  if (phase() === 'playing') {
    unbindEscape = keymap.bind('escape', close, { when: 'always' });
    watchdog = setTimeout(close, playlist.length ? 12000 : 1200);
  }
  cleanup(() => {
    disposed = true;
    unbindEscape?.();
    if (watchdog !== undefined) clearTimeout(watchdog);
    if (fadeDeadline !== undefined) clearTimeout(fadeDeadline);
    reveal.stop();
    fade.stop();
  });

  const fill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;
  return <>{phase() !== 'closed' && <View testID="startup-splash" style={{ ...fill, zIndex: 30, opacity: fade.opacity,
    backgroundColor: '#091631', backgroundImage: 'linear-gradient(155deg, #203967, #0a1935 60%, #061024)', overflow: 'hidden' }}>
    {!playlist.length && <View testID={curtainVisible() ? 'startup-brand' : 'startup-brand-revealed'}
      onLayout={() => revealContent(0)}
      style={{ ...fill, justifyContent: 'center', alignItems: 'center', gap: 12 }}>
      <Image src={brandIcon} style={{ width: 68, height: 68, borderRadius: 16 }} />
      <Text style={{ fontSize: 24, color: '#f6e6bc', fontFamily: t.fontFamily, fontWeight: '600' }}>沐码</Text>
    </View>}
    {playlist.map((source, index) => active() === index && <Video src={source}
      testID={loaded() && !curtainVisible() ? 'startup-video-ready' : 'startup-video'}
      style={{ ...fill, opacity: loaded() ? 1 : 0, pointerEvents: 'none', objectFit: 'cover' }}
      muted controls={false} paused={phase() === 'fading'} onLoad={() => revealContent(index)}
      onEnd={() => { if (active() === index) close(); }} onError={() => failed(index)} />)}
    {curtainVisible() && <View testID="startup-curtain"
      style={{ ...fill, zIndex: 1, backgroundColor: '#091631', opacity: reveal.opacity, pointerEvents: 'none' }} />}
    <Button testID="startup-splash-skip" accessibilityLabel="跳过开屏" onPress={close}
      style={{ ...fill, zIndex: 2, justifyContent: 'flex-end', alignItems: 'flex-end', padding: 20, backgroundColor: 'transparent' }}>
      <Text style={{ fontFamily: t.fontFamily, fontSize: 12, color: '#fbf6e8', backgroundColor: '#101c36d4',
        paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9 }}>点击或 Esc 跳过</Text>
    </Button>
  </View>}</>;
}
