/** Width/height attributes reserve the intrinsic ratio before the image is decoded. */
export function imageDimensions(value: unknown): { width: number; height: number } | undefined {
  if (!value || typeof value !== 'object') return;
  const { width, height } = value as Record<string, unknown>;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  return { width, height };
}

export function imageGeometryStyle(dimensions: ReturnType<typeof imageDimensions>, maxHeight: number | null) {
  return {
    ...(maxHeight ? { '--bbi-figure-max-h': `${maxHeight}px` } : {}),
    ...(dimensions ? {
      '--bbi-image-ratio': `${dimensions.width} / ${dimensions.height}`,
      '--bbi-placeholder-width': maxHeight ? `${maxHeight * dimensions.width / dimensions.height}px` : '100%',
    } : {}),
  };
}
