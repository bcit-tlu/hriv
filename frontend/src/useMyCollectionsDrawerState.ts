import { usePinnedDrawerState } from './usePinnedDrawerState'

export function useMyCollectionsDrawerState(userScope: string) {
  return usePinnedDrawerState(userScope, 'my-collections-drawer')
}
