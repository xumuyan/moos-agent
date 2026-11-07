# Direct source provenance

Copyright (c) 2026 DeepSeek, MIT (full notice: root THIRD_PARTY_NOTICES.md).

Upstream deepseek-ai/deepseek-harness commit `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`.
CSS files below are unmodified byte copies from `packages/client/ui-conversation/src/client/skeleton/`.

DshComposer.tsx directly ports the presentation hierarchy and primary button SVG from InputBar.tsx, DraftEditor.tsx (input/editor/) and EmptyHero.tsx. The host adapter replaces framework hooks/Lexical with typed props and a controlled textarea, omits unavailable attachment/queue/plan features, and preserves Moos plugin slots once. Hero title/brand remain Moos. Workspace label is informational, not a fake workspace-picker button.

- `HeroShell.module.css` SHA256 `9135bc0f982858c67158f977f205c23382ccc0bfd10e15bce0aca1247002107e`
- `ConversationRoot.module.css` SHA256 `61b52c8daf686e98e379cb4f671ccee063ebace923cdbc15e88b6304078377e2`
- `InputBar.module.css` SHA256 `98180b4cbc8fa6169f7554bc2a7f477051cf6ec8108813b019db5cd760e06fd6`
