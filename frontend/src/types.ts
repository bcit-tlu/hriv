export interface ImageItem {
  id: string
  label: string
  thumb: string
  tileSources: string
}

export interface Category {
  id: string
  label: string
  children: Category[]
  images: ImageItem[]
}

export const MAX_DEPTH = 6
