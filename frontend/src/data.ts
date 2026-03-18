import type { Category } from './types'

export const rootCategories: Category[] = [
  {
    id: 'architecture',
    label: 'Architecture',
    images: [],
    children: [
      {
        id: 'italian',
        label: 'Italian',
        images: [
          {
            id: 'duomo',
            label: 'Duomo di Milano',
            thumb:
              'https://openseadragon.github.io/example-images/duomo/duomo_files/11/0_0.jpg',
            tileSources:
              'https://openseadragon.github.io/example-images/duomo/duomo.dzi',
          },
        ],
        children: [
          {
            id: 'gothic',
            label: 'Gothic',
            images: [
              {
                id: 'duomo-gothic',
                label: 'Duomo di Milano (Gothic Detail)',
                thumb:
                  'https://openseadragon.github.io/example-images/duomo/duomo_files/11/0_0.jpg',
                tileSources:
                  'https://openseadragon.github.io/example-images/duomo/duomo.dzi',
              },
            ],
            children: [],
          },
        ],
      },
      {
        id: 'american',
        label: 'American',
        images: [
          {
            id: 'highsmith',
            label: 'Highsmith Panorama',
            thumb:
              'https://openseadragon.github.io/example-images/highsmith/highsmith_files/11/0_0.jpg',
            tileSources:
              'https://openseadragon.github.io/example-images/highsmith/highsmith.dzi',
          },
        ],
        children: [],
      },
    ],
  },
  {
    id: 'panoramas',
    label: 'Panoramas',
    images: [
      {
        id: 'highsmith-pano',
        label: 'Library of Congress',
        thumb:
          'https://openseadragon.github.io/example-images/highsmith/highsmith_files/11/0_0.jpg',
        tileSources:
          'https://openseadragon.github.io/example-images/highsmith/highsmith.dzi',
      },
    ],
    children: [],
  },
]
