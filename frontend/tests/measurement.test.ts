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
  computeMagnification,
  createMeasurementLabel,
  CSS_PIXEL_UM,
  formatMeasurement,
  unitToMicrons,
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

describe('unitToMicrons', () => {
  it('returns 1 for micrometres (um)', () => {
    expect(unitToMicrons('um')).toBe(1)
  })

  it('returns 1 for micrometres (µm micro sign U+00B5)', () => {
    expect(unitToMicrons('µm')).toBe(1)
  })

  it('returns 1 for micrometres (μm Greek small mu U+03BC)', () => {
    // Microscope software and pasted scientific text commonly use the Greek
    // small letter mu rather than the dedicated micro sign.
    expect(unitToMicrons('\u03bcm')).toBe(1)
  })

  it('normalises Greek mu regardless of case', () => {
    expect(unitToMicrons('\u03bcM')).toBe(1)
  })

  it('returns 1000 for millimetres', () => {
    expect(unitToMicrons('mm')).toBe(1000)
  })

  it('returns 10000 for centimetres', () => {
    expect(unitToMicrons('cm')).toBe(10000)
  })

  it('returns 1000000 for metres', () => {
    expect(unitToMicrons('m')).toBe(1_000_000)
  })

  it('returns 25400 for inches', () => {
    expect(unitToMicrons('in')).toBe(25400)
  })

  it('is case-insensitive', () => {
    expect(unitToMicrons('MM')).toBe(1000)
    expect(unitToMicrons('CM')).toBe(10000)
    expect(unitToMicrons('UM')).toBe(1)
  })

  it('returns undefined for unknown units', () => {
    expect(unitToMicrons('furlongs')).toBeUndefined()
    expect(unitToMicrons('px')).toBeUndefined()
  })
})

describe('computeMagnification with Greek mu unit', () => {
  it('computes the same magnification for μm (Greek) as for µm (micro sign)', () => {
    const greek: MeasurementConfig = { scale: 8, unit: '\u03bcm' }
    const micro: MeasurementConfig = { scale: 8, unit: '\u00b5m' }
    const magGreek = computeMagnification(1, greek, 1)
    const magMicro = computeMagnification(1, micro, 1)
    expect(magGreek).toBeDefined()
    expect(magGreek).toBeCloseTo(magMicro!, 6)
  })
})

describe('computeMagnification', () => {
  it('returns undefined when no config is provided', () => {
    expect(computeMagnification(2.5, undefined)).toBeUndefined()
  })

  it('returns undefined when scale is missing', () => {
    const config: MeasurementConfig = { unit: 'um' }
    expect(computeMagnification(3, config)).toBeUndefined()
  })

  it('returns undefined when scale is zero', () => {
    const config: MeasurementConfig = { scale: 0, unit: 'um' }
    expect(computeMagnification(1, config)).toBeUndefined()
  })

  it('returns undefined when scale is negative', () => {
    const config: MeasurementConfig = { scale: -5, unit: 'mm' }
    expect(computeMagnification(1, config)).toBeUndefined()
  })

  it('returns undefined when unit is missing', () => {
    const config: MeasurementConfig = { scale: 8 }
    expect(computeMagnification(1, config)).toBeUndefined()
  })

  it('computes real-world magnification for um scale at imageZoom 1 (dpr=1)', () => {
    // 8 px/µm → each image pixel = 0.125 µm
    // CSS pixel = 25400/96 µm ≈ 264.583 (dpr=1 → physical = CSS)
    // mag = 264.583 / 0.125 = 2116.67
    const config: MeasurementConfig = { scale: 8, unit: 'um' }
    const mag = computeMagnification(1, config, 1)
    expect(mag).toBeCloseTo(CSS_PIXEL_UM * 8, 2)
  })

  it('halves magnification when dpr doubles', () => {
    const config: MeasurementConfig = { scale: 8, unit: 'um' }
    const mag1 = computeMagnification(1, config, 1)!
    const mag2 = computeMagnification(1, config, 2)!
    expect(mag2).toBeCloseTo(mag1 / 2, 2)
  })

  it('scales linearly with imageZoom', () => {
    const config: MeasurementConfig = { scale: 8, unit: 'um' }
    const mag1 = computeMagnification(1, config, 1)!
    const mag2 = computeMagnification(2, config, 1)!
    expect(mag2).toBeCloseTo(mag1 * 2, 2)
  })

  it('computes magnification for mm scale', () => {
    // 2 px/mm → each image pixel = 0.5 mm = 500 µm
    // mag = 264.583 / 500 ≈ 0.529 (dpr=1)
    const config: MeasurementConfig = { scale: 2, unit: 'mm' }
    const mag = computeMagnification(1, config, 1)
    expect(mag).toBeCloseTo(CSS_PIXEL_UM / 500, 4)
  })

  it('computes magnification for cm scale', () => {
    const config: MeasurementConfig = { scale: 1, unit: 'cm' }
    // 1 px/cm → each pixel = 10000 µm
    const mag = computeMagnification(1, config, 1)
    expect(mag).toBeCloseTo(CSS_PIXEL_UM / 10000, 6)
  })

  it('returns undefined for unknown unit strings', () => {
    const config: MeasurementConfig = { scale: 8, unit: 'px' }
    expect(computeMagnification(2, config)).toBeUndefined()
  })

  it('treats dpr=0 as dpr=1 (guard against invalid values)', () => {
    const config: MeasurementConfig = { scale: 4, unit: 'um' }
    const magDpr0 = computeMagnification(1, config, 0)
    const magDpr1 = computeMagnification(1, config, 1)
    expect(magDpr0).toBeCloseTo(magDpr1!, 2)
  })

  it('defaults dpr to 1 when omitted', () => {
    const config: MeasurementConfig = { scale: 4, unit: 'um' }
    const magDefault = computeMagnification(1, config)
    const magExplicit = computeMagnification(1, config, 1)
    expect(magDefault).toBeCloseTo(magExplicit!, 2)
  })
})
