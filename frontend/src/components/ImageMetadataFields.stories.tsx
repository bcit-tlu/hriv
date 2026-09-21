import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import Stack from '@mui/material/Stack'
import ImageMetadataFields, { type ImageMetadataValues } from './ImageMetadataFields'

// A small stateful wrapper so the controlled fields are interactive in the
// Storybook UI (typing/toggling updates them) while still snapshotting cleanly.
function ImageMetadataFieldsExample({
  initial,
  categoryHidden,
}: {
  initial: ImageMetadataValues
  categoryHidden?: boolean
}) {
  const [values, setValues] = useState<ImageMetadataValues>(initial)
  return (
    <Stack spacing={2} sx={{ width: '100%', maxWidth: 480 }}>
      <ImageMetadataFields values={values} onChange={setValues} categoryHidden={categoryHidden} />
    </Stack>
  )
}

const meta = {
  title: 'Components/ImageMetadataFields',
  component: ImageMetadataFieldsExample,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Shared copyright / note / visibility fields reused across the upload and edit ' +
          'image modals. The note field enforces a max length with a live counter.',
      },
    },
  },
} satisfies Meta<typeof ImageMetadataFieldsExample>

export default meta

type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: { initial: { copyright: '', note: '', active: true } },
}

export const Filled: Story = {
  args: {
    initial: {
      copyright: '2026 BCIT',
      note: 'North elevation, morning light.\nScanned from the original 35mm slide.',
      active: true,
    },
  },
}

export const HiddenByCategory: Story = {
  name: 'Hidden By Category',
  args: {
    initial: { copyright: '2026 BCIT', note: 'Restricted archive image.', active: false },
    categoryHidden: true,
  },
}
