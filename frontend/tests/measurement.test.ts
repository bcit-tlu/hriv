/**
 * Unit tests for the measurement utilities in ImageViewer.tsx.
 *
 * `formatMeasurement` is a pure function with branching precision logic —
 * decimal-place count varies with the real-world magnitude and the
 * presence/absence of a scale configuration.  `createMeasurementLabel`
 * is a DOM helper whose inline-style contract the overlay renderer depends on.
 *
 * Covers https://github.com/bcit-tlu/hriv/issues/25
 */

import { describe, expect, it } from 'vitest'

import {
    createMeasurementLabel,
    formatMeasurement,
    type MeasurementConfig,
} from '../src/components/imageViewerUtils'

describe('formatMeasurement', () => {
    describe('without a measurement configuration (fallback to pixels)', () => {
        it('returns pixel count when no config is provided', () => {
            // Half the viewport width of a 1000 px image = 500 px
            expect(formatMeasurement(0.5, 1000, undefined)).toBe('500 px')
        })

        it('returns pixel count when scale is missing', () => {
            const config: MeasurementConfig = { scale: undefined, unit: 'mm' }
            expect(formatMeasurement(0.25, 2000, config)).toBe('500 px')
        })

        it('returns pixel count when scale is zero (avoid divide-by-zero)', () => {
            const config: MeasurementConfig = { scale: 0, unit: 'um' }
            expect(formatMeasurement(0.1, 10000, config)).toBe('1000 px')
        })

        it('returns pixel count when scale is negative', () => {
            const config: MeasurementConfig = { scale: -1, unit: 'mm' }
            expect(formatMeasurement(0.5, 1000, config)).toBe('500 px')
        })

        it('rounds fractional pixel values', () => {
            expect(formatMeasurement(0.1234, 1000, undefined)).toBe('123 px')
        })
    })

    describe('with a valid scale configuration (real-world units)', () => {
        it('uses zero decimal places for values ≥ 100', () => {
            // pixels = 0.5 * 1000 = 500; scale 5 px/unit → 100 units
            const config: MeasurementConfig = { scale: 5, unit: 'mm' }
            expect(formatMeasurement(0.5, 1000, config)).toBe('100 mm')
        })

        it('uses zero decimal places for values well above 100', () => {
            // pixels = 1.0 * 1000 = 1000; scale 2 px/unit → 500 units
            const config: MeasurementConfig = { scale: 2, unit: 'um' }
            expect(formatMeasurement(1.0, 1000, config)).toBe('500 um')
        })

        it('uses one decimal place for values in [1, 100)', () => {
            // pixels = 0.5 * 100 = 50; scale 5 px/unit → 10 units
            const config: MeasurementConfig = { scale: 5, unit: 'mm' }
            expect(formatMeasurement(0.5, 100, config)).toBe('10.0 mm')
        })

        it('uses one decimal place for values just under 100', () => {
            // pixels = 0.5 * 1000 = 500; scale 5.1 → 98.039...
            const config: MeasurementConfig = { scale: 5.1, unit: 'mm' }
            expect(formatMeasurement(0.5, 1000, config)).toBe('98.0 mm')
        })

        it('uses two decimal places for values in (0, 1)', () => {
            // pixels = 0.1 * 100 = 10; scale 20 → 0.5 units
            const config: MeasurementConfig = { scale: 20, unit: 'mm' }
            expect(formatMeasurement(0.1, 100, config)).toBe('0.50 mm')
        })

        it('uses two decimal places for very small measurements', () => {
            // pixels = 0.001 * 100 = 0.1; scale 1 → 0.1 units
            const config: MeasurementConfig = { scale: 1, unit: 'um' }
            expect(formatMeasurement(0.001, 100, config)).toBe('0.10 um')
        })

        it('handles an explicitly empty unit string gracefully', () => {
            // pixels = 1 * 100 = 100; scale 1 → 100 units
            const config: MeasurementConfig = { scale: 1, unit: '' }
            expect(formatMeasurement(1, 100, config)).toBe('100 ')
        })

        it('handles missing unit (uses empty string in output)', () => {
            const config: MeasurementConfig = { scale: 2 }
            // pixels = 1 * 100 = 100; scale 2 → 50 units, one decimal
            expect(formatMeasurement(1, 100, config)).toBe('50.0 ')
        })

        it('handles very large measurements (well into the integer bucket)', () => {
            // pixels = 10 * 10000 = 100_000; scale 1 → 100_000
            const config: MeasurementConfig = { scale: 1, unit: 'px' }
            expect(formatMeasurement(10, 10000, config)).toBe('100000 px')
        })
    })

    describe('boundary rounding at 1 and 100', () => {
        it('value exactly 1 uses one decimal place', () => {
            // pixels = 1 * 100 = 100; scale 100 → 1.0
            const config: MeasurementConfig = { scale: 100, unit: 'mm' }
            expect(formatMeasurement(1, 100, config)).toBe('1.0 mm')
        })

        it('value exactly 100 uses zero decimal places', () => {
            // pixels = 1 * 100 = 100; scale 1 → 100
            const config: MeasurementConfig = { scale: 1, unit: 'mm' }
            expect(formatMeasurement(1, 100, config)).toBe('100 mm')
        })

        it('value just below 1 uses two decimal places', () => {
            // pixels = 0.99 * 100 = 99; scale 100 → 0.99
            const config: MeasurementConfig = { scale: 100, unit: 'mm' }
            expect(formatMeasurement(0.99, 100, config)).toBe('0.99 mm')
        })
    })
})

describe('createMeasurementLabel', () => {
    it('returns a DIV element', () => {
        const label = createMeasurementLabel()
        expect(label).toBeInstanceOf(HTMLDivElement)
        expect(label.tagName).toBe('DIV')
    })

    it('is hidden by default (display:none until positioned)', () => {
        const label = createMeasurementLabel()
        expect(label.style.display).toBe('none')
    })

    it('applies the expected inline style contract', () => {
        const label = createMeasurementLabel()
        expect(label.style.position).toBe('absolute')
        expect(label.style.color).toBe('rgb(255, 0, 0)')
        expect(label.style.fontFamily).toBe('monospace')
        expect(label.style.fontSize).toBe('12px')
        expect(label.style.fontWeight).toBe('600')
        expect(label.style.whiteSpace).toBe('nowrap')
        expect(label.style.pointerEvents).toBe('none')
        expect(label.style.zIndex).toBe('10')
        // The white "outline" effect relies on four offset shadows.
        expect(label.style.textShadow).toContain('#fff')
    })

    it('returns a fresh element on each call', () => {
        const a = createMeasurementLabel()
        const b = createMeasurementLabel()
        expect(a).not.toBe(b)
        a.textContent = 'A'
        expect(b.textContent).toBe('')
    })

    it('produces a label with no text content initially', () => {
        const label = createMeasurementLabel()
        expect(label.textContent).toBe('')
    })
})
