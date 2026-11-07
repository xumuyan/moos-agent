# Direct-source menu presentation

Copyright (c) 2026 DeepSeek. MIT, root THIRD_PARTY_NOTICES.md.
Source deepseek-ai/deepseek-harness at fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159.

Byte-identical copies: ui-primitives/src/Menu.module.css and MenuSurface.module.css, ui-model-selection/src/client/ModelSelect.module.css, ui-permission-presets/src/client/PermissionSelect.module.css.

PermissionIcon.tsx copies ui-primitives/src/PermissionIcon.tsx with only imports redirected to the local exact icon implementation. Picker.tsx ports trigger/row/material/check hierarchy from ModelSelect/PermissionSelect/Menu; framework shares are replaced by props and localStorage. No permission enforcement is claimed. Menu position uses the host DOM rect rather than upstream CSS anchor/backing lifecycle. No search/effort/model capability feature is faked.

- `Menu.module.css` SHA256 `ac03c6b4777b1b86e0e2ae09591fd2fe3c0da5718c493b458f67cbc7990b7649`
- `MenuSurface.module.css` SHA256 `9ec1f4b089ac40163475245661d27cc118a73238d3ce5e5fb5dbc4475a6f7589`
- `ModelSelect.module.css` SHA256 `30c8644eb09dedfe1ac79675c2b1873284db11a9921f02b73ddb17ab4591cf3d`
- `PermissionSelect.module.css` SHA256 `101d81ec2a796b95d3e51a1800e3cacdb969715498a9e72a47739a33d1ecdbed`
