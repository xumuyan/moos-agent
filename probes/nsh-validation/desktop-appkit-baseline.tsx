// The stock AppKit runner has no embedding app; this only tests and measures that runner.
import { host, mount, signal, Text, View } from 'nsh';
import { Application } from 'nsh/desktop';

async function fingerprint() {
  let outcome = 'unexpected-success';
  try {
    await host.call('projects.list', {}, { timeout: 2000 });
  } catch (error) {
    outcome = (error as { code?: string }).code ?? 'unknown-error';
  }
  return `APPKIT_BASELINE ${host.available()} ${outcome}`;
}

const status = signal('checking');
async function check() { status.set(await fingerprint()); }
mount(() => <View class="flex-1 items-center justify-center bg-background">
  <View role="button" onPress={check}><Text>Check host</Text></View>
  <Text>{status()}</Text>
</View>);
// Production-side measurement reports only the exact outcome, with no raw error/arguments.
if (!host.params.hold) setTimeout(async () => {
  const result = await fingerprint();
  status.set(result);
  console.log(result);
  setTimeout(() => Application.quit(), 1000);
}, 0);
