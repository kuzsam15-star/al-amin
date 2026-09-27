export const cropZoomRange = Object.freeze({ min: 1, max: 1.8 });
export const defaultProfileCrop = Object.freeze({ positionX: 50, positionY: 50, zoom: 1 });
export const defaultAvatarCrop = Object.freeze({ positionX: 50, positionY: 24, zoom: 1 });

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

export function normalizePhotoCrop(value, fallback = defaultProfileCrop) {
  return {
    positionX: clamp(value?.positionX ?? fallback.positionX, 0, 100),
    positionY: clamp(value?.positionY ?? fallback.positionY, 0, 100),
    zoom: clamp(value?.zoom ?? fallback.zoom, cropZoomRange.min, cropZoomRange.max),
  };
}

export function photoCropGeometry(sourceWidth, sourceHeight, aspect, cropValue) {
  const width = Math.max(1, Number(sourceWidth) || 1);
  const height = Math.max(1, Number(sourceHeight) || 1);
  const targetAspect = Math.max(0.01, Number(aspect) || 1);
  const crop = normalizePhotoCrop(cropValue);
  let baseWidth;
  let baseHeight;
  if (width / height > targetAspect) {
    baseHeight = height;
    baseWidth = height * targetAspect;
  } else {
    baseWidth = width;
    baseHeight = width / targetAspect;
  }
  const cropWidth = baseWidth / crop.zoom;
  const cropHeight = baseHeight / crop.zoom;
  const availableX = Math.max(0, width - cropWidth);
  const availableY = Math.max(0, height - cropHeight);
  const left = availableX * crop.positionX / 100;
  const top = availableY * crop.positionY / 100;
  return { width, height, crop, cropWidth, cropHeight, availableX, availableY, left, top };
}

function cropFromOrigin(geometry, left, top, zoom = geometry.crop.zoom) {
  return {
    positionX: geometry.availableX > 0 ? clamp(left / geometry.availableX * 100, 0, 100) : 50,
    positionY: geometry.availableY > 0 ? clamp(top / geometry.availableY * 100, 0, 100) : 50,
    zoom: clamp(zoom, cropZoomRange.min, cropZoomRange.max),
  };
}

export function panPhotoCrop(cropValue, sourceWidth, sourceHeight, aspect, deltaX, deltaY, frameWidth, frameHeight) {
  const geometry = photoCropGeometry(sourceWidth, sourceHeight, aspect, cropValue);
  const left = clamp(geometry.left - Number(deltaX || 0) * geometry.cropWidth / Math.max(1, frameWidth), 0, geometry.availableX);
  const top = clamp(geometry.top - Number(deltaY || 0) * geometry.cropHeight / Math.max(1, frameHeight), 0, geometry.availableY);
  return cropFromOrigin(geometry, left, top);
}

export function zoomPhotoCropAt(cropValue, sourceWidth, sourceHeight, aspect, nextZoom, focalX, focalY, nextFocalX = focalX, nextFocalY = focalY) {
  const before = photoCropGeometry(sourceWidth, sourceHeight, aspect, cropValue);
  const sourceX = before.left + clamp(focalX, 0, 1) * before.cropWidth;
  const sourceY = before.top + clamp(focalY, 0, 1) * before.cropHeight;
  const normalizedZoom = clamp(nextZoom, cropZoomRange.min, cropZoomRange.max);
  const after = photoCropGeometry(sourceWidth, sourceHeight, aspect, { ...before.crop, zoom: normalizedZoom });
  const left = clamp(sourceX - clamp(nextFocalX, 0, 1) * after.cropWidth, 0, after.availableX);
  const top = clamp(sourceY - clamp(nextFocalY, 0, 1) * after.cropHeight, 0, after.availableY);
  return cropFromOrigin(after, left, top, normalizedZoom);
}

export function photoCropImageStyle(sourceWidth, sourceHeight, aspect, cropValue) {
  const geometry = photoCropGeometry(sourceWidth, sourceHeight, aspect, cropValue);
  return {
    width: `${geometry.width / geometry.cropWidth * 100}%`,
    height: `${geometry.height / geometry.cropHeight * 100}%`,
    left: `${-geometry.left / geometry.cropWidth * 100}%`,
    top: `${-geometry.top / geometry.cropHeight * 100}%`,
  };
}

export function photoCropExtractRect(sourceWidth, sourceHeight, aspect, cropValue) {
  const geometry = photoCropGeometry(sourceWidth, sourceHeight, aspect, cropValue);
  const width = Math.max(1, Math.min(geometry.width, Math.round(geometry.cropWidth)));
  const height = Math.max(1, Math.min(geometry.height, Math.round(geometry.cropHeight)));
  return {
    left: Math.max(0, Math.min(Math.round(geometry.left), Math.round(geometry.width) - width)),
    top: Math.max(0, Math.min(Math.round(geometry.top), Math.round(geometry.height) - height)),
    width,
    height,
  };
}
