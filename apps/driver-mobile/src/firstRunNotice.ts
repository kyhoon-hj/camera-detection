export const FIRST_RUN_NOTICE_STORAGE_KEY = "suha.first-run-privacy-notice.v1";
export const FIRST_RUN_NOTICE_ACKNOWLEDGED = "acknowledged";

export function shouldShowFirstRunNotice(storedValue: string | null): boolean {
  return storedValue !== FIRST_RUN_NOTICE_ACKNOWLEDGED;
}
