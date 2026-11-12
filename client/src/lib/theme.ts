import { create } from 'zustand';

export type Theme = 'dark' | 'light' | 'system';

const read = (): Theme => {
  try {
    const t = localStorage.getItem('kb_theme');
    return t === 'light' || t === 'system' ? t : 'dark';
  } catch {
    return 'dark';
  }
};

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && Boolean(media?.matches));
  document.documentElement.classList.toggle('dark', dark);
}

export const useTheme = create<{ theme: Theme; setTheme: (t: Theme) => void; toggle: () => void }>((set, get) => ({
  theme: read(),
  setTheme(theme) {
    try {
      localStorage.setItem('kb_theme', theme);
    } catch {
      /* private mode */
    }
    applyTheme(theme);
    set({ theme });
  },
  toggle() {
    const isDark = document.documentElement.classList.contains('dark');
    get().setTheme(isDark ? 'light' : 'dark');
  },
}));

media?.addEventListener('change', () => {
  if (useTheme.getState().theme === 'system') applyTheme('system');
});
