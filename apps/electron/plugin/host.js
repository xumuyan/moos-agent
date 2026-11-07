export const name = 'moos-electron-shell';
export const inject = ['tools'];

export function apply(ctx) {
  // The upstream session driver still builds a model request while PI owns
  // tool calls. Give it an empty catalogue and reject any attempted fallback.
  ctx.effect(() => ctx.tools.setExecutor({
    describe: () => ({ schemas: [], knownNames: [] }),
    async execute() {
      throw new Error('Moos 的任务工具由 PI 执行');
    },
  }));
}
