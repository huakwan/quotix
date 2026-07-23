export interface LoginItemApp {
  getLoginItemSettings(): { openAtLogin: boolean };
  setLoginItemSettings(settings: { openAtLogin: boolean }): void;
}

export function readOpenAtLogin(app: LoginItemApp, fallback = false): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return fallback;
  }
}

export function syncOpenAtLogin<T extends { openAtLogin: boolean }>(
  app: LoginItemApp,
  current: T,
): T {
  const openAtLogin = readOpenAtLogin(app, current.openAtLogin);
  return openAtLogin === current.openAtLogin ? current : { ...current, openAtLogin };
}

export function updateOpenAtLogin(
  app: LoginItemApp,
  enabled: boolean,
  fallback = false,
): boolean {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
  } catch {
    return readOpenAtLogin(app, fallback);
  }
  return readOpenAtLogin(app, fallback);
}
