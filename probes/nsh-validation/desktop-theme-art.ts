import type { ImageAsset } from 'nsh';
// Safe source-checkout default. The explicit local preview runner replaces this
// module ONLY inside artifacts/ after checking all artwork SHA-256 values.
// Never substitute invented art or read a production directory at runtime.
export const art: Record<string, ImageAsset | undefined> = {};
export const artAvailable = false;
