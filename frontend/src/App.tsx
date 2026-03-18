import { useState } from 'react'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Container from '@mui/material/Container'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardMedia from '@mui/material/CardMedia'
import CardContent from '@mui/material/CardContent'
import Button from '@mui/material/Button'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ImageViewer from './components/ImageViewer'

interface DemoImage {
  id: string
  label: string
  thumb: string
  tileSources: string
}

const DEMO_IMAGES: DemoImage[] = [
  {
    id: 'duomo',
    label: 'Duomo di Milano',
    thumb:
      'https://openseadragon.github.io/example-images/duomo/duomo_files/11/0_0.jpg',
    tileSources:
      'https://openseadragon.github.io/example-images/duomo/duomo.dzi',
  },
  {
    id: 'highsmith',
    label: 'Highsmith Panorama',
    thumb:
      'https://openseadragon.github.io/example-images/highsmith/highsmith_files/11/0_0.jpg',
    tileSources:
      'https://openseadragon.github.io/example-images/highsmith/highsmith.dzi',
  },
]

export default function App() {
  const [selected, setSelected] = useState<DemoImage | null>(null)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* App bar */}
      <AppBar position="static" elevation={1}>
        <Toolbar>
          {selected && (
            <IconButton
              edge="start"
              color="inherit"
              aria-label="back"
              sx={{ mr: 1 }}
              onClick={() => setSelected(null)}
            >
              <ArrowBackIcon />
            </IconButton>
          )}
          <Typography variant="h6" component="h1" sx={{ flexGrow: 1 }}>
            Corgi
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            OpenSeadragon Demo
          </Typography>
        </Toolbar>
      </AppBar>

      {/* Main content */}
      <Box component="main" sx={{ flexGrow: 1, py: 4 }}>
        <Container maxWidth="lg">
          {selected ? (
            /* ---- Viewer mode ---- */
            <>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  mb: 2,
                }}
              >
                <Typography variant="h5">{selected.label}</Typography>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setSelected(null)}
                >
                  Back to gallery
                </Button>
              </Box>

              <Paper elevation={3} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <ImageViewer tileSources={selected.tileSources} />
              </Paper>

              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Use your scroll wheel to zoom, or click and drag to pan.
                  Pinch-to-zoom is supported on touch devices. The mini-map in
                  the bottom-right corner shows your current viewport.
                </Typography>
              </Box>
            </>
          ) : (
            /* ---- Gallery mode ---- */
            <>
              <Box sx={{ textAlign: 'center', mb: 4 }}>
                <ZoomInIcon
                  sx={{ fontSize: 48, color: 'primary.main', mb: 1 }}
                />
                <Typography variant="h4" gutterBottom>
                  High-Resolution Image Viewer
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  Select an image below to explore it with deep-zoom
                  powered by OpenSeadragon.
                </Typography>
              </Box>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    sm: 'repeat(2, 1fr)',
                  },
                  gap: 3,
                }}
              >
                {DEMO_IMAGES.map((img) => (
                  <Card key={img.id} elevation={2}>
                    <CardActionArea onClick={() => setSelected(img)}>
                      <CardMedia
                        component="img"
                        height="220"
                        image={img.thumb}
                        alt={img.label}
                        sx={{ objectFit: 'cover' }}
                      />
                      <CardContent>
                        <Typography variant="h6">{img.label}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          Click to open deep-zoom viewer
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                ))}
              </Box>
            </>
          )}
        </Container>
      </Box>

      {/* Footer */}
      <Box
        component="footer"
        sx={{
          py: 2,
          textAlign: 'center',
          bgcolor: 'grey.100',
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="caption" color="text.secondary">
          Built with React, Vite, Material UI &amp; OpenSeadragon
        </Typography>
      </Box>
    </Box>
  )
}
