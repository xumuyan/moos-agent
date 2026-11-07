import { createHash } from 'node:crypto';

const verify = /^(?:(?:npm|pnpm|bun|yarn) (?:run )?test|cargo test|go test(?: \.\/\.\.\.)?|(?:python3? -m )?(?:pytest|unittest)|(?:\/bin\/)?(?:ba)?sh (?:\.\/)?(?:test|tests)\.sh)$/;
const environmentFailure = /command not found|no such file or directory|cannot find module|modulenotfounderror|permission denied|operation not permitted|timed out|econn|enotfound|failed to download/i;

export function repairRouting() {
  const commands = new Map();
  const failures = new Map();
  let revision = 0;
  return {
    event(event) {
      if (event.type === 'tool_execution_start' && event.toolName === 'bash') {
        const command = event.args?.command;
        if (typeof command === 'string' && verify.test(command.trim())) {
          commands.set(event.toolCallId, { command: command.trim(), revision });
        }
      }
      if (event.type !== 'tool_execution_end') return;
      if (!event.isError && ['write', 'edit'].includes(event.toolName)) revision++;
      const check = commands.get(event.toolCallId);
      commands.delete(event.toolCallId);
      if (!check) return;
      const { command, revision: checkedRevision } = check;
      const previous = failures.get(command);
      if (previous && checkedRevision < previous.revision) return;
      const exit = event.result?.structuredContent?.exit_code;
      const output = event.result?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n');
      if (!event.isError || !Number.isInteger(exit) || exit === 0 || exit === 126 || exit === 127 ||
        !output || environmentFailure.test(output)) {
        failures.delete(command);
        return;
      }
      const signature = createHash('sha256').update(output.trim()).digest('hex');
      const repairs = previous?.signature === signature ? previous.repairs + Number(checkedRevision > previous.revision) : 0;
      failures.set(command, { signature, repairs, revision: checkedRevision });
    },
    ready: () => [...failures.values()].some(failure => failure.repairs >= 2),
  };
}
