import { BOARD_FIXTURE, INUKSUK_FIXTURE } from '../../components/inuksukFixtures'

export const PROTOTYPE_ITEM = {
  ...INUKSUK_FIXTURE,
  title: 'Renal corpuscle',
  description: 'Compare the capsule and surrounding tubules.',
}
export const PROTOTYPE_BOARD = {
  ...BOARD_FIXTURE,
  name: 'Renal histology',
  inuksuks: [PROTOTYPE_ITEM],
}
