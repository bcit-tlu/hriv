import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Container from '@mui/material/Container'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import SchoolIcon from '@mui/icons-material/School'
import PersonIcon from '@mui/icons-material/Person'
import type { User } from '../types'

const ROLE_ICONS: Record<string, React.ReactNode> = {
  admin: <AdminPanelSettingsIcon fontSize="small" />,
  instructor: <SchoolIcon fontSize="small" />,
  student: <PersonIcon fontSize="small" />,
}

const ROLE_COLORS: Record<string, 'error' | 'warning' | 'info'> = {
  admin: 'error',
  instructor: 'warning',
  student: 'info',
}

interface LoginScreenProps {
  users: User[]
  onLogin: (userId: string) => void
}

export default function LoginScreen({ users, onLogin }: LoginScreenProps) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
      }}
    >
      <Container maxWidth="sm">
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Typography variant="h4" gutterBottom>
            Corgi Image Library
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Select a user to sign in
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {users.map((user) => (
            <Card key={user.id} elevation={2}>
              <CardContent
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Box>
                  <Typography variant="subtitle1">{user.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {user.email}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip
                    icon={ROLE_ICONS[user.role] as React.ReactElement}
                    label={user.role}
                    size="small"
                    color={ROLE_COLORS[user.role]}
                    variant="outlined"
                  />
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => onLogin(user.id)}
                  >
                    Sign in
                  </Button>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      </Container>
    </Box>
  )
}
