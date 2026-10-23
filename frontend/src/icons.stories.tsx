import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import AddToPhotosIcon from '@mui/icons-material/AddToPhotos'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import BadgeIcon from '@mui/icons-material/Badge'
import BrightnessAutoIcon from '@mui/icons-material/BrightnessAuto'
import CampaignIcon from '@mui/icons-material/Campaign'
import CancelIcon from '@mui/icons-material/Cancel'
import CheckIcon from '@mui/icons-material/Check'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined'
import CloseIcon from '@mui/icons-material/Close'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import CollectionsIcon from '@mui/icons-material/Collections'
import CopyrightIcon from '@mui/icons-material/Copyright'
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder'
import CropSquareIcon from '@mui/icons-material/CropSquare'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import DeleteIcon from '@mui/icons-material/Delete'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import DoneIcon from '@mui/icons-material/Done'
import DownloadIcon from '@mui/icons-material/Download'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove'
import EditIcon from '@mui/icons-material/Edit'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FilterListIcon from '@mui/icons-material/FilterList'
import FolderIcon from '@mui/icons-material/Folder'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import FolderZipIcon from '@mui/icons-material/FolderZip'
import GroupsIcon from '@mui/icons-material/Groups'
import HomeIcon from '@mui/icons-material/Home'
import ImageIcon from '@mui/icons-material/Image'
import InfoIcon from '@mui/icons-material/Info'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import LightModeIcon from '@mui/icons-material/LightMode'
import LineWeightIcon from '@mui/icons-material/LineWeight'
import LinkIcon from '@mui/icons-material/Link'
import LockIcon from '@mui/icons-material/Lock'
import LogoutIcon from '@mui/icons-material/Logout'
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts'
import MenuIcon from '@mui/icons-material/Menu'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import NotificationsIcon from '@mui/icons-material/Notifications'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PaletteIcon from '@mui/icons-material/Palette'
import PeopleIcon from '@mui/icons-material/People'
import PersonIcon from '@mui/icons-material/Person'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
import PublicIcon from '@mui/icons-material/Public'
import PublishIcon from '@mui/icons-material/Publish'
import RefreshIcon from '@mui/icons-material/Refresh'
import ReorderIcon from '@mui/icons-material/Reorder'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import SaveIcon from '@mui/icons-material/Save'
import SchoolIcon from '@mui/icons-material/School'
import ScreenRotationIcon from '@mui/icons-material/ScreenRotation'
import SearchIcon from '@mui/icons-material/Search'
import StickyNote2Icon from '@mui/icons-material/StickyNote2'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import SyncProblemIcon from '@mui/icons-material/SyncProblem'
import TextFieldsIcon from '@mui/icons-material/TextFields'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import ViewCarouselIcon from '@mui/icons-material/ViewCarousel'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

// Material Icons (@mui/icons-material) currently used across HRIV, with their import names.
// Sorted alphabetically; add new icons here as components adopt them.
const ICONS = [
  { name: 'Add', Icon: AddIcon },
  { name: 'AddPhotoAlternate', Icon: AddPhotoAlternateIcon },
  { name: 'AddToPhotos', Icon: AddToPhotosIcon },
  { name: 'AdminPanelSettings', Icon: AdminPanelSettingsIcon },
  { name: 'ArrowBack', Icon: ArrowBackIcon },
  { name: 'ArrowDropDown', Icon: ArrowDropDownIcon },
  { name: 'ArrowForward', Icon: ArrowForwardIcon },
  { name: 'AutoAwesome', Icon: AutoAwesomeIcon },
  { name: 'Badge', Icon: BadgeIcon },
  { name: 'BrightnessAuto', Icon: BrightnessAutoIcon },
  { name: 'Campaign', Icon: CampaignIcon },
  { name: 'Cancel', Icon: CancelIcon },
  { name: 'Check', Icon: CheckIcon },
  { name: 'CheckCircle', Icon: CheckCircleIcon },
  { name: 'CheckCircleOutline', Icon: CheckCircleOutlineIcon },
  { name: 'ChevronLeft', Icon: ChevronLeftIcon },
  { name: 'ChevronRight', Icon: ChevronRightIcon },
  { name: 'CircleOutlined', Icon: CircleOutlinedIcon },
  { name: 'Close', Icon: CloseIcon },
  { name: 'CloudUpload', Icon: CloudUploadIcon },
  { name: 'Collections', Icon: CollectionsIcon },
  { name: 'Copyright', Icon: CopyrightIcon },
  { name: 'CreateNewFolder', Icon: CreateNewFolderIcon },
  { name: 'CropSquare', Icon: CropSquareIcon },
  { name: 'DarkMode', Icon: DarkModeIcon },
  { name: 'Delete', Icon: DeleteIcon },
  { name: 'DeleteSweep', Icon: DeleteSweepIcon },
  { name: 'Done', Icon: DoneIcon },
  { name: 'Download', Icon: DownloadIcon },
  { name: 'DragIndicator', Icon: DragIndicatorIcon },
  { name: 'DriveFileMove', Icon: DriveFileMoveIcon },
  { name: 'Edit', Icon: EditIcon },
  { name: 'ErrorOutline', Icon: ErrorOutlineIcon },
  { name: 'ExpandMore', Icon: ExpandMoreIcon },
  { name: 'FilterList', Icon: FilterListIcon },
  { name: 'Folder', Icon: FolderIcon },
  { name: 'FolderOutlined', Icon: FolderOutlinedIcon },
  { name: 'FolderZip', Icon: FolderZipIcon },
  { name: 'Groups', Icon: GroupsIcon },
  { name: 'Home', Icon: HomeIcon },
  { name: 'Image', Icon: ImageIcon },
  { name: 'Info', Icon: InfoIcon },
  { name: 'InfoOutlined', Icon: InfoOutlinedIcon },
  { name: 'LightMode', Icon: LightModeIcon },
  { name: 'LineWeight', Icon: LineWeightIcon },
  { name: 'Link', Icon: LinkIcon },
  { name: 'Lock', Icon: LockIcon },
  { name: 'Logout', Icon: LogoutIcon },
  { name: 'ManageAccounts', Icon: ManageAccountsIcon },
  { name: 'Menu', Icon: MenuIcon },
  { name: 'MenuBook', Icon: MenuBookIcon },
  { name: 'MoreVert', Icon: MoreVertIcon },
  { name: 'Notifications', Icon: NotificationsIcon },
  { name: 'OpenInNew', Icon: OpenInNewIcon },
  { name: 'Palette', Icon: PaletteIcon },
  { name: 'People', Icon: PeopleIcon },
  { name: 'Person', Icon: PersonIcon },
  { name: 'PersonAdd', Icon: PersonAddIcon },
  { name: 'PhotoLibrary', Icon: PhotoLibraryIcon },
  { name: 'PlaylistAdd', Icon: PlaylistAddIcon },
  { name: 'Public', Icon: PublicIcon },
  { name: 'Publish', Icon: PublishIcon },
  { name: 'Refresh', Icon: RefreshIcon },
  { name: 'Reorder', Icon: ReorderIcon },
  { name: 'RestartAlt', Icon: RestartAltIcon },
  { name: 'Save', Icon: SaveIcon },
  { name: 'School', Icon: SchoolIcon },
  { name: 'ScreenRotation', Icon: ScreenRotationIcon },
  { name: 'Search', Icon: SearchIcon },
  { name: 'StickyNote2', Icon: StickyNote2Icon },
  { name: 'SwapHoriz', Icon: SwapHorizIcon },
  { name: 'SyncProblem', Icon: SyncProblemIcon },
  { name: 'TextFields', Icon: TextFieldsIcon },
  { name: 'UploadFile', Icon: UploadFileIcon },
  { name: 'ViewCarousel', Icon: ViewCarouselIcon },
  { name: 'ViewColumn', Icon: ViewColumnIcon },
  { name: 'Visibility', Icon: VisibilityIcon },
  { name: 'VisibilityOff', Icon: VisibilityOffIcon },
  { name: 'WarningAmber', Icon: WarningAmberIcon },
] as const

function Icons() {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
        gap: 2,
      }}
    >
      {ICONS.map(({ name, Icon }) => (
        <Stack
          key={name}
          alignItems="center"
          spacing={0.5}
          sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
        >
          <Icon />
          <Typography variant="caption" align="center" sx={{ wordBreak: 'break-word' }}>
            {name}
          </Typography>
        </Stack>
      ))}
    </Box>
  )
}

const meta = {
  title: 'Foundations/Icons',
  component: Icons,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The Material Icons (@mui/icons-material) currently used across HRIV, each shown with ' +
          'its import name. Use these as the shared icon set; import per-path by name, e.g. ' +
          'FilterList, Search.',
      },
    },
  },
} satisfies Meta<typeof Icons>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: 'Icons' }
