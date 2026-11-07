import { createContext } from 'react';

/** The frame owns the resolved width and transition lifetime of the right track. */
export const RightPanelFrame = createContext<{ width: number; open: boolean } | null>(null);
