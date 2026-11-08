# Third-Party Notices

This project depends on third-party packages recorded in its lock files. The notice below covers the separately reviewed design reference used for the P02 interface work.

## DeepSeek Harness

- Project: `deepseek-ai/deepseek-harness`
- Source: https://github.com/deepseek-ai/deepseek-harness
- Reviewed revision: `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`
- License: MIT
- Copyright: Copyright (c) 2026 DeepSeek
- Moos usage status: P02.1 uses an independently implemented Moos layout and adapter contract informed by the public project structure. No DeepSeek Harness source file, official name, logo, whale artwork, or other brand asset is copied into Moos in P02.1. Any later copied or substantially adapted source must be listed in `docs/third-party/deepseek-harness.md` before delivery.

P03 update (2026-11-07): Moos now adapts the original column geometry and portions of the theme, navigation, chat/input and settings presentation under the same MIT revision. Exact source paths and adaptation boundaries: `docs/third-party/dsh-full-frontend-sources.md`. Official brand assets and the upstream runtime remain excluded. The P02.1 statement above records the historical implementation only.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


## Native terminal dependencies (P02.8)

### portable-pty 0.9.0

Source: https://github.com/wezterm/wezterm/tree/main/pty

MIT License

Copyright (c) 2018 Wez Furlong

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


### @xterm/xterm 6.0.0 and @xterm/addon-fit 0.11.0

Source: https://github.com/xtermjs/xterm.js

Copyright (c) 2017-2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)
Copyright (c) 2014-2016, SourceLair Private Company (https://www.sourcelair.com)
Copyright (c) 2012-2013, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

P03.7 update (2026-11-07): 44 original source sheets/primitives are copied byte-for-byte, with host presentation adapters and original source paths recorded in `docs/evidence/desktop/tauri-upstream-source-lock.json`. See `docs/third-party/dsh-direct-source-p037.md` for the framework, brand and local image-skin boundaries. This supersedes the earlier approximate presentation implementation; historical statements remain dated above.
