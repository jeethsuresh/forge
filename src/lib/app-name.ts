export const APP_DISPLAY_NAME = "Forge";

export const DEFAULT_GIT_USER_NAME = `${APP_DISPLAY_NAME} Agent`;

export function appDisplayInitial(): string {
  const trimmed = APP_DISPLAY_NAME.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "F";
}
