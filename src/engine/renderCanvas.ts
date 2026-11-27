export type RenderCanvas = HTMLCanvasElement | OffscreenCanvas
export type RenderContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function createRenderCanvas(): RenderCanvas {
  return typeof document === 'undefined'
    ? new OffscreenCanvas(1, 1)
    : document.createElement('canvas')
}

export function getRenderContext(canvas: RenderCanvas, alpha = false): RenderContext {
  const context = canvas.getContext('2d', { alpha }) as RenderContext | null
  if (!context) throw new Error('Unable to create the slideshow drawing surface.')
  return context
}
