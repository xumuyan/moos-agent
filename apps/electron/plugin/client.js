window.__ModuleLoader__.load({
  id: 'moos-electron-shell',
  factory(require) {
    const { createElement } = require('react');
    const sidebarIcon = ({ size }) => createElement('img', {
      src: 'data:image/png;base64,__MOOS_SIDEBAR_ICON__',
      alt: '', width: size, height: size, draggable: false, 'data-moos-sidebar-icon': '',
    });
    const sidebarName = () => createElement('span', { 'data-moos-sidebar-name': '' }, 'Moos');
    const mark = ({ size, className }) => createElement('span', {
      className, 'aria-label': 'M', role: 'img', 'data-moos-mark': '',
      style: { fontSize: size * 0.66, fontWeight: 720, lineHeight: 1 },
    }, 'M');

    function apply(ctx) {
      const root = document.documentElement;
      // Desktop chrome uses the native layout, but shortcuts still use the web transport.
      if (root.dataset.moosWindow === 'darwin') root.dataset.platform = 'darwin';
      for (const [name, component] of [
        ['sidebar.brand.mark', sidebarIcon],
        ['sidebar.brand.name', sidebarName],
        ['conversation.hero.brand.mark', mark],
      ]) {
        ctx.slots.inject(name, () => ctx.slots.register({ name }, component));
      }
      const styles = document.createElement('style');
      styles.textContent = `
        [data-skin-chrome="titlebar-brand"] { display: none !important; }
        html[data-platform="darwin"] [data-sidebar-toggle] [data-moos-sidebar-icon] { display: none; }
        html[data-dsh-skin="maid-atelier"] [data-moos-sidebar-name] { color: #f3e3c0; }
        [data-plugin-package="moos-electron-shell"] { display: none !important; }
      `;
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
        if (root.dataset.moosWindow === 'darwin') delete root.dataset.platform;
      });
    }
    return { inject: ['slots', 'shortcuts'], apply };
  },
});
