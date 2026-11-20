export type AdminNavTheme = 'light' | 'realDark';

const THEME_PREFERENCE_KEY = 'socialhub.admin.navTheme';

export const getSavedNavTheme = (fallback: AdminNavTheme): AdminNavTheme => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const savedTheme = window.localStorage.getItem(THEME_PREFERENCE_KEY);
    return savedTheme === 'realDark' || savedTheme === 'light'
      ? savedTheme
      : fallback;
  } catch {
    return fallback;
  }
};

export const saveNavTheme = (theme: unknown) => {
  if (
    (theme !== 'realDark' && theme !== 'light') ||
    typeof window === 'undefined'
  ) {
    return;
  }

  try {
    window.localStorage.setItem(THEME_PREFERENCE_KEY, theme);
  } catch {
    // The selected theme still applies for the current session if storage is unavailable.
  }
};
