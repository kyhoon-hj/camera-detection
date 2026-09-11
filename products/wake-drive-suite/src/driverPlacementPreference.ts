export const DRIVER_PLACEMENT_GUIDE_KEY = 'driver-placement-guide.v1';
export const shouldShowDriverPlacementGuide = (stored: string | null) => stored !== 'hidden';

export function saveDriverPlacementChoice(storage: Pick<Storage, 'setItem'>, hide: boolean): void {
  // Confirm is for this visit only. Hide persists only after a successful write.
  if (hide) storage.setItem(DRIVER_PLACEMENT_GUIDE_KEY, 'hidden');
}
