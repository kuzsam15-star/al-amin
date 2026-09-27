export type PhotoCrop = { positionX: number; positionY: number; zoom: number };
export const cropZoomRange: Readonly<{ min: number; max: number }>;
export const defaultProfileCrop: Readonly<PhotoCrop>;
export const defaultAvatarCrop: Readonly<PhotoCrop>;
export function normalizePhotoCrop(value?: Partial<PhotoCrop> | null, fallback?: Readonly<PhotoCrop>): PhotoCrop;
export function photoCropGeometry(sourceWidth: number, sourceHeight: number, aspect: number, cropValue: PhotoCrop): {
  width: number; height: number; crop: PhotoCrop; cropWidth: number; cropHeight: number;
  availableX: number; availableY: number; left: number; top: number;
};
export function panPhotoCrop(cropValue: PhotoCrop, sourceWidth: number, sourceHeight: number, aspect: number, deltaX: number, deltaY: number, frameWidth: number, frameHeight: number): PhotoCrop;
export function zoomPhotoCropAt(cropValue: PhotoCrop, sourceWidth: number, sourceHeight: number, aspect: number, nextZoom: number, focalX: number, focalY: number, nextFocalX?: number, nextFocalY?: number): PhotoCrop;
export function photoCropImageStyle(sourceWidth: number, sourceHeight: number, aspect: number, cropValue: PhotoCrop): { width: string; height: string; left: string; top: string };
export function photoCropExtractRect(sourceWidth: number, sourceHeight: number, aspect: number, cropValue: PhotoCrop): { left: number; top: number; width: number; height: number };
