import Box from '@mui/material/Box'

export default function LoginSplashImage() {
  return (
    <Box
      aria-hidden="true"
      sx={{
        flex: '0 0 50%',
        backgroundImage: 'url(/hriv-splash2.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: { xs: 'none', md: 'block' },
      }}
    />
  )
}
