/** Shared by settings and the header shortcuts; preserve the field the user changed. */
export function normalizeImageLimits(options: { minImages: number; maxImages: number }, changed?: 'minImages' | 'maxImages'): void {
  let minimum = Math.max(0, Math.floor(Number(options.minImages) || 0));
  let maximum = Math.max(1, Math.floor(Number(options.maxImages) || 1));
  if (changed === 'minImages') maximum = Math.max(maximum, minimum);
  else minimum = Math.min(minimum, maximum);
  options.minImages = minimum;
  options.maxImages = maximum;
}
