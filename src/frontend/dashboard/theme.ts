export type Theme = 'light' | 'dark' | 'system';

export const THEME_KEY = 'agenda:theme';

// Roda antes da primeira pintura, direto no <head>: sem isso a tela pisca clara antes do React
// montar. Mantido em string porque precisa ser inline no HTML servido.
export const THEME_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}`;

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'dark' || saved === 'light' ? saved : 'system';
  } catch {
    // Navegador com armazenamento bloqueado: segue o sistema, sem quebrar a tela.
    return 'system';
  }
}
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // A escolha vale para esta sessão mesmo sem conseguir guardar.
  }
}
