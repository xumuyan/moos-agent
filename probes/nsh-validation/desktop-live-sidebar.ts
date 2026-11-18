// Live screenshot observation, not a computed-style export or a source CSS token.
// Existing pinned static palette remains the no-art fallback.
export function liveSidebar(artwork: boolean, dark: boolean) {
  return {
    backgroundColor: artwork ? (dark ? '#08132d80' : '#24396752') : '#0a173b',
    backgroundImage: artwork
      ? 'linear-gradient(#b4c4e01f, #7e98c41a)'
      : 'radial-gradient(circle at 50% 14%, #5b77bc3b, #0000 31%), linear-gradient(#102456f7, #050e2bf5), repeating-linear-gradient(135deg, #ffffff07 0 1px, #0000 1px 7px)',
    brand: {
      height: 58, marginTop: 44, flexShrink: 0, borderRadius: 5,
      borderWidth: 1, borderColor: '#e2cfaa9c',
      backgroundImage: 'linear-gradient(#172b5be8, #080f2ff5)',
      boxShadow: 'inset 0 0 0 3px #050e2b9e, 0 2px 5px #02071847',
      paddingHorizontal: 12,
    },
  } as const;
}
