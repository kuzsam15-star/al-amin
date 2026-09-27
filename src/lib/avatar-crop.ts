import type { CSSProperties } from "react";
import type { AvatarCrop } from "@/lib/static-content";

export const defaultAvatarCrop: AvatarCrop = { positionX: 50, positionY: 24, zoom: 1 };

export function avatarCropStyle(value?: Partial<AvatarCrop>): CSSProperties {
  const positionX = value?.positionX ?? defaultAvatarCrop.positionX;
  const positionY = value?.positionY ?? defaultAvatarCrop.positionY;
  const zoom = value?.zoom ?? defaultAvatarCrop.zoom;
  return {
    objectPosition: `${positionX}% ${positionY}%`,
    transform: `scale(${zoom})`,
    transformOrigin: `${positionX}% ${positionY}%`,
  };
}
