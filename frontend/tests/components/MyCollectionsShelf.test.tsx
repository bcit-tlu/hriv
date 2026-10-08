import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import MyCollectionsShelf from '../../src/components/MyCollectionsShelf'
import { makeCategory, makeCollectionSummary } from '../helpers/fixtures'

describe('MyCollectionsShelf', () => {
  it('renders read-only cards and wires See all and card clicks', () => {
    const collections = [
      makeCollectionSummary({ id: 1, name: 'Sequence overview', type: 'sequence' }),
      makeCollectionSummary({ id: 2, name: 'Synchronized review', type: 'synchronized' }),
    ]
    const onOpen = vi.fn()
    const onSeeAll = vi.fn()
    render(
      <MyCollectionsShelf
        collections={collections}
        categories={[]}
        programs={[]}
        onOpen={onOpen}
        onSeeAll={onSeeAll}
      />,
    )

    expect(screen.getByRole('heading', { name: 'My collections' })).toBeInTheDocument()
    expect(screen.getByText('Sequence overview')).toBeInTheDocument()
    expect(screen.getByText('Synchronized review')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'See all' }))
    expect(onSeeAll).toHaveBeenCalledOnce()
    fireEvent.click(screen.getAllByTestId('collection-card-action-area')[0])
    expect(onOpen).toHaveBeenCalledWith(collections[0])
  })

  it('desaturates a card filed under a hidden category', () => {
    render(
      <MyCollectionsShelf
        collections={[makeCollectionSummary({ id: 1, categoryId: 11 })]}
        categories={[
          makeCategory({
            id: 10,
            label: 'Hidden parent',
            status: 'hidden',
            children: [makeCategory({ id: 11, label: 'Filed category', parentId: 10 })],
          }),
        ]}
        programs={[]}
        onOpen={vi.fn()}
        onSeeAll={vi.fn()}
      />,
    )

    expect(screen.getByTestId('collection-card-action-area')).toHaveStyle({
      filter: 'grayscale(100%)',
    })
    expect(screen.queryByRole('img', { name: 'Hidden by category' })).not.toBeInTheDocument()
  })

  it('renders nothing when there are no collections', () => {
    const { container } = render(
      <MyCollectionsShelf
        collections={[]}
        categories={[]}
        programs={[]}
        onOpen={vi.fn()}
        onSeeAll={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
