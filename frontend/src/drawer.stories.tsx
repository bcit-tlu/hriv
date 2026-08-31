import { Fragment, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import MenuIcon from '@mui/icons-material/Menu'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'

import SwipeableDrawer from '@mui/material/SwipeableDrawer'
import Typography from '@mui/material/Typography'
import { getNavigationItems } from './navigation'

type DrawerVariant = 'temporary' | 'persistent' | 'permanent'
type DrawerAnchor = 'left' | 'right' | 'top' | 'bottom'
type DrawerContent = 'navigation' | 'settings' | 'long content'
type DrawerRole = 'admin' | 'instructor' | 'student'

interface DrawerStoryArgs {
  drawerVariant: DrawerVariant
  anchor: DrawerAnchor
  initialOpen: boolean
  width: number
  elevation: number
  content: DrawerContent
  hideBackdrop: boolean
  keepMounted: boolean
  swipeable: boolean
  role: DrawerRole
  onOpen: () => void
  onClose: () => void
}

function DrawerContentExample({
  content,
  onClose,
  role,
  showCloseButton,
}: {
  content: DrawerContent
  onClose: () => void
  role: DrawerRole
  showCloseButton: boolean
}) {
  const title =
    content === 'settings'
      ? 'Settings'
      : content === 'long content'
        ? 'Drawer contents'
        : 'Navigation'
  const navigation =
    content === 'navigation'
      ? getNavigationItems({
          canEditContent: role !== 'student',
          canManageUsers: role === 'admin',
        })
      : []
  const items = Array.from({ length: 8 }, (_, index) => `Menu item ${index + 1}`)

  return (
    <Box sx={{ width: 280, maxWidth: '80vw' }} role="presentation">
      <Stack alignItems="center" direction="row" justifyContent="space-between" sx={{ p: 2 }}>
        <Typography variant="h6">{title}</Typography>
        {showCloseButton && (
          <IconButton aria-label="Close drawer" onClick={onClose} size="small">
            <ChevronLeftIcon />
          </IconButton>
        )}
      </Stack>
      <Divider />
      <List>
        {content === 'navigation'
          ? navigation.map((item, index) => (
              <Fragment key={item.id}>
                {item.section === 'manage' &&
                  (index === 0 || navigation[index - 1]?.section !== 'manage') && (
                    <ListSubheader>Manage</ListSubheader>
                  )}
                <ListItem disablePadding>
                  <ListItemButton
                    onClick={onClose}
                    sx={item.section === 'manage' ? { pl: 4 } : undefined}
                  >
                    <ListItemText primary={item.label} />
                  </ListItemButton>
                </ListItem>
              </Fragment>
            ))
          : items.map((item) => (
              <ListItem disablePadding key={item}>
                <ListItemButton>
                  <ListItemText primary={item} />
                </ListItemButton>
              </ListItem>
            ))}
      </List>
    </Box>
  )
}

function DrawerExample(args: DrawerStoryArgs) {
  const [open, setOpen] = useState(args.drawerVariant === 'permanent' || args.initialOpen)
  const isPermanent = args.drawerVariant === 'permanent'
  const isHorizontal = args.anchor === 'top' || args.anchor === 'bottom'
  const drawerWidth = isHorizontal ? '100%' : args.width
  const drawerContent = (
    <DrawerContentExample
      content={args.content}
      onClose={() => {
        setOpen(false)
        args.onClose()
      }}
      role={args.role}
      showCloseButton={!isPermanent}
    />
  )

  return (
    <Paper
      sx={{
        display: 'flex',
        minHeight: 420,
        overflow: 'hidden',
        position: 'relative',
        width: 960,
        maxWidth: '90vw',
      }}
      variant="outlined"
    >
      <Box sx={{ flex: 1, minWidth: 0, p: 3 }}>
        <Stack alignItems="flex-start" spacing={2}>
          <Typography variant="h5">Drawer preview</Typography>
          <Typography color="text.secondary" variant="body2">
            {args.drawerVariant} drawer anchored to the {args.anchor}.
          </Typography>
          {!isPermanent && (
            <Button
              aria-label="Open drawer"
              onClick={() => {
                setOpen(true)
                args.onOpen()
              }}
              startIcon={<MenuIcon />}
              variant="contained"
            >
              Open drawer
            </Button>
          )}
        </Stack>
      </Box>
      {args.swipeable && args.drawerVariant === 'temporary' ? (
        <SwipeableDrawer
          anchor={args.anchor}
          disableBackdropTransition={false}
          disableDiscovery={false}
          hideBackdrop={args.hideBackdrop}
          ModalProps={{ keepMounted: args.keepMounted }}
          onClose={() => {
            setOpen(false)
            args.onClose()
          }}
          onOpen={() => {
            setOpen(true)
            args.onOpen()
          }}
          open={open}
          slotProps={{ paper: { elevation: args.elevation, sx: { width: drawerWidth } } }}
        >
          {drawerContent}
        </SwipeableDrawer>
      ) : (
        <Drawer
          anchor={args.anchor}
          hideBackdrop={args.hideBackdrop}
          ModalProps={{ keepMounted: args.keepMounted }}
          onClose={() => {
            setOpen(false)
            args.onClose()
          }}
          open={open}
          slotProps={{ paper: { elevation: args.elevation, sx: { width: drawerWidth } } }}
          variant={args.drawerVariant}
        >
          {drawerContent}
        </Drawer>
      )}
    </Paper>
  )
}

const meta = {
  title: 'Components/Drawer',
  component: DrawerExample,
  parameters: {
    design: {
      type: 'figma',
      url: 'https://www.figma.com/design/pUsjnGhqrizbgTZhfaGxsD/mobile-ideation?node-id=49-1602&t=necEqVHxwstTPlLR-4',
    },
    layout: 'centered',
    docs: {
      description: {
        component:
          'Reference for MUI Drawer navigation surfaces used in HRIV-style application layouts, including temporary, persistent, permanent, anchored, and swipeable variants.',
      },
    },
  },
  argTypes: {
    drawerVariant: {
      control: 'inline-radio',
      options: ['temporary', 'persistent', 'permanent'],
      description: 'MUI Drawer variant: overlay, layout-preserving, or always-visible.',
    },
    anchor: {
      control: 'inline-radio',
      options: ['left', 'right', 'top', 'bottom'],
      description: 'Side from which the drawer opens.',
    },
    initialOpen: {
      control: 'boolean',
      description: 'Whether a temporary or persistent drawer starts open.',
    },
    width: {
      control: { type: 'number', min: 200, max: 480, step: 20 },
      description: 'Drawer paper width for left/right drawers.',
    },
    elevation: {
      control: { type: 'number', min: 0, max: 24, step: 1 },
      description: 'MUI paper elevation applied to the drawer.',
    },
    content: {
      control: 'select',
      options: ['navigation', 'settings', 'long content'],
      description: 'Content fixture used to preview common drawer contents.',
    },
    hideBackdrop: {
      control: 'boolean',
      description: 'Hide the modal backdrop for temporary/swipeable drawers.',
    },
    keepMounted: {
      control: 'boolean',
      description: 'Keep temporary drawer contents mounted in the DOM.',
    },
    swipeable: {
      control: 'boolean',
      description: 'Use MUI SwipeableDrawer for temporary mobile-friendly behavior.',
    },
    role: {
      control: 'inline-radio',
      options: ['admin', 'instructor', 'student'],
      description: 'Role used to determine which shared navigation items are visible.',
    },
    onOpen: {
      table: { disable: true },
      description: 'Storybook action spy called when the drawer opens.',
    },
    onClose: {
      table: { disable: true },
      description: 'Storybook action spy called when the drawer closes.',
    },
  },
  args: {
    drawerVariant: 'temporary',
    anchor: 'left',
    initialOpen: false,
    width: 280,
    elevation: 16,
    content: 'navigation',
    hideBackdrop: false,
    keepMounted: true,
    swipeable: false,
    role: 'admin',
    onOpen: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof DrawerExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: (args) => <DrawerExample {...args} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const documentBody = within(canvasElement.ownerDocument.body)

    await expect(canvas.getByRole('button', { name: 'Open drawer' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Open drawer' }))
    await expect(documentBody.getByRole('heading', { name: 'Navigation' })).toBeVisible()
    await expect(args.onOpen).toHaveBeenCalledTimes(1)

    await userEvent.click(documentBody.getByRole('button', { name: 'Close drawer' }))
    await expect(documentBody.queryByRole('heading', { name: 'Navigation' })).toBeNull()
    await expect(args.onClose).toHaveBeenCalledTimes(1)
  },
}

export const Swipeable: Story = {
  args: { drawerVariant: 'temporary', swipeable: true },
  render: (args) => <DrawerExample {...args} />,
}
