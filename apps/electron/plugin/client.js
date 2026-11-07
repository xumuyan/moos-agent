window.__ModuleLoader__.load({
  id: 'moos-electron-shell',
  factory(require) {
    const { createElement } = require('react');
    const hidden = () => null;
    const mark = ({ size, className }) => createElement('span', {
      className, 'aria-label': 'M', role: 'img', 'data-moos-mark': '',
      style: { fontSize: size * 0.66, fontWeight: 720, lineHeight: 1 },
    }, 'M');

    function apply(ctx) {
      for (const [name, component] of [
        ['sidebar.brand.mark', hidden],
        ['sidebar.brand.name', hidden],
        ['conversation.hero.brand.mark', mark],
      ]) {
        ctx.slots.inject(name, () => ctx.slots.register({ name }, component));
      }
      const styles = document.createElement('style');
      // Reviewed skin hooks may insert a separate copy of the upstream title brand.
      styles.textContent = '[data-skin-chrome="titlebar-brand"] { display: none !important; }';
      document.head.append(styles);
      const title = document.querySelector('title');
      const renameTitle = () => {
        if (document.title.includes('DeepSeek Harness')) {
          document.title = document.title.replaceAll('DeepSeek Harness', 'Moos');
        }
      };
      const observer = new MutationObserver(renameTitle);
      if (title) observer.observe(title, { childList: true, characterData: true, subtree: true });
      renameTitle();
      ctx.on('dispose', () => {
        observer.disconnect();
        styles.remove();
      });
    }
    return { inject: ['slots'], apply };
  },
});
