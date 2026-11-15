export interface GalleryExportImage {
  src: string;
  download: string;
}

interface GalleryExportProgress {
  written: number;
  failed: number;
}

function directoryPicker() {
  if (typeof window === 'undefined') return;
  const host = window as Window & {
    showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  };
  const picker = host.showDirectoryPicker;
  return typeof picker === 'function' ? picker.bind(host) : undefined;
}

export function canExportGalleryToDirectory(): boolean {
  return Boolean(directoryPicker());
}

export async function pickGalleryExportDirectory(): Promise<FileSystemDirectoryHandle> {
  const pick = directoryPicker();
  if (!pick) throw new Error('当前客户端无法选择导出目录');
  return pick({ mode: 'readwrite' });
}

async function availableFileName(directory: FileSystemDirectoryHandle, download: string): Promise<string> {
  const name = download.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '');
  const extensionStart = name.lastIndexOf('.');
  const extension = extensionStart > 0 ? name.slice(extensionStart) : '';
  const stem = (extension ? name.slice(0, extensionStart) : name) || 'image';
  const safeStem = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem) ? `_${stem}` : stem;

  for (let sequence = 1; ; sequence++) {
    const candidate = sequence === 1 ? `${safeStem}${extension}` : `${safeStem} (${sequence})${extension}`;
    try {
      await directory.getFileHandle(candidate);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return candidate;
      // A directory with the same name also occupies the destination.
      if (!(error instanceof DOMException) || error.name !== 'TypeMismatchError') throw error;
    }
  }
}

async function copyImage(
  directory: FileSystemDirectoryHandle,
  image: GalleryExportImage,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(image.src, { mode: 'same-origin', signal });
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || (mime && !mime.startsWith('image/') && mime !== 'application/octet-stream')) {
    throw new Error(`图片读取失败 (${response.status})`);
  }
  const bytes = await response.blob();
  if (!bytes.size) throw new Error('图片文件为空');

  const name = await availableFileName(directory, image.download);
  if (signal.aborted) throw signal.reason;
  const file = await directory.getFileHandle(name, { create: true });
  let writable: FileSystemWritableFileStream | undefined;
  try {
    writable = await file.createWritable();
    if (signal.aborted) throw signal.reason;
    await writable.write(bytes);
    if (signal.aborted) throw signal.reason;
    await writable.close();
  } catch (error) {
    await writable?.abort().catch(() => {});
    // Creating the handle can leave an empty file even if no data was committed.
    try {
      if (!(await file.getFile()).size) await directory.removeEntry(name);
    } catch {
      // Access to the directory can be lost during export.
    }
    throw error;
  }
}

export async function exportGalleryImages(
  directory: FileSystemDirectoryHandle,
  images: readonly GalleryExportImage[],
  signal: AbortSignal,
  onProgress: (progress: GalleryExportProgress) => void,
): Promise<GalleryExportProgress> {
  let written = 0;
  let failed = 0;
  // Read and write one original at a time to keep memory use independent of the selection size.
  for (const image of images) {
    if (signal.aborted) break;
    try {
      await copyImage(directory, image, signal);
      written++;
    } catch (error) {
      if (signal.aborted) break;
      console.warn('[柏宝绘] 导出图片失败', image.download, error);
      failed++;
    }
    onProgress({ written, failed });
  }
  return { written, failed };
}
