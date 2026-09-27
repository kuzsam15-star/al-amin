"use client";
/* eslint-disable @next/next/no-img-element */

import { Minus, Move, Plus } from "lucide-react";
import { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, useEffect, useId, useRef, useState } from "react";
import {
  cropZoomRange,
  normalizePhotoCrop,
  panPhotoCrop,
  photoCropImageStyle,
  zoomPhotoCropAt,
} from "@/lib/photo-crop.mjs";
import type { PhotoCrop } from "@/lib/photo-crop.mjs";
import styles from "./catalog-submission-form.module.css";

type Point = { x: number; y: number };
type PanGesture = { kind: "pan"; pointerId: number; start: Point; crop: PhotoCrop };
type PinchGesture = { kind: "pinch"; pointerIds: [number, number]; distance: number; midpoint: Point; crop: PhotoCrop };
type Gesture = PanGesture | PinchGesture | null;

function distance(first: Point, second: Point) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpoint(first: Point, second: Point) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export function PhotoCropSurface({
  label,
  description,
  src,
  alt,
  aspect,
  round = false,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  description: string;
  src: string;
  alt: string;
  aspect: number;
  round?: boolean;
  value: PhotoCrop;
  defaultValue: PhotoCrop;
  onChange: (value: PhotoCrop) => void;
}) {
  const descriptionId = useId();
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<Gesture>(null);
  const valueRef = useRef(value);

  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => {
    pointersRef.current.clear();
    gestureRef.current = null;
    setNaturalSize({ width: 0, height: 0 });
  }, [src]);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !naturalSize.width || !naturalSize.height) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const bounds = surface.getBoundingClientRect();
      const focalX = (event.clientX - bounds.left) / Math.max(1, bounds.width);
      const focalY = (event.clientY - bounds.top) / Math.max(1, bounds.height);
      const factor = Math.exp(-event.deltaY * 0.0015);
      const next = normalizePhotoCrop(zoomPhotoCropAt(valueRef.current, naturalSize.width, naturalSize.height, aspect, valueRef.current.zoom * factor, focalX, focalY), defaultValue);
      valueRef.current = next;
      onChange(next);
    };
    surface.addEventListener("wheel", handleWheel, { passive: false });
    return () => surface.removeEventListener("wheel", handleWheel);
  }, [aspect, defaultValue, naturalSize.height, naturalSize.width, onChange]);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    // iOS Safari may still start document scrolling while Pointer Events own
    // the crop. A local non-passive touch guard makes the crop surface the
    // gesture owner without changing normal page scrolling anywhere else.
    const preventNativeGesture = (event: globalThis.Event) => {
      if (event.cancelable) event.preventDefault();
    };
    surface.addEventListener("touchstart", preventNativeGesture, { passive: false });
    surface.addEventListener("touchmove", preventNativeGesture, { passive: false });
    surface.addEventListener("gesturestart", preventNativeGesture, { passive: false });
    surface.addEventListener("gesturechange", preventNativeGesture, { passive: false });
    return () => {
      surface.removeEventListener("touchstart", preventNativeGesture);
      surface.removeEventListener("touchmove", preventNativeGesture);
      surface.removeEventListener("gesturestart", preventNativeGesture);
      surface.removeEventListener("gesturechange", preventNativeGesture);
    };
  }, []);

  function emit(next: PhotoCrop) {
    const normalized = normalizePhotoCrop(next, defaultValue);
    valueRef.current = normalized;
    onChange(normalized);
  }

  function localPoint(point: Point, target = surfaceRef.current) {
    const bounds = target?.getBoundingClientRect();
    if (!bounds) return { x: 0.5, y: 0.5 };
    return {
      x: Math.min(1, Math.max(0, (point.x - bounds.left) / Math.max(1, bounds.width))),
      y: Math.min(1, Math.max(0, (point.y - bounds.top) / Math.max(1, bounds.height))),
    };
  }

  function beginGesture() {
    const pointers = [...pointersRef.current.entries()];
    if (pointers.length >= 2) {
      const [first, second] = pointers;
      gestureRef.current = {
        kind: "pinch",
        pointerIds: [first[0], second[0]],
        distance: Math.max(1, distance(first[1], second[1])),
        midpoint: midpoint(first[1], second[1]),
        crop: valueRef.current,
      };
    } else if (pointers.length === 1) {
      gestureRef.current = { kind: "pan", pointerId: pointers[0][0], start: pointers[0][1], crop: valueRef.current };
    } else {
      gestureRef.current = null;
    }
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!naturalSize.width || !naturalSize.height) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginGesture();
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId) || !naturalSize.width || !naturalSize.height) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const bounds = event.currentTarget.getBoundingClientRect();
    if (pointersRef.current.size >= 2) {
      if (gestureRef.current?.kind !== "pinch") beginGesture();
      const gesture = gestureRef.current;
      if (!gesture || gesture.kind !== "pinch") return;
      const first = pointersRef.current.get(gesture.pointerIds[0]);
      const second = pointersRef.current.get(gesture.pointerIds[1]);
      if (!first || !second) { beginGesture(); return; }
      const currentMidpoint = midpoint(first, second);
      const nextZoom = gesture.crop.zoom * distance(first, second) / gesture.distance;
      const startLocal = localPoint(gesture.midpoint, event.currentTarget);
      const nextLocal = localPoint(currentMidpoint, event.currentTarget);
      emit(zoomPhotoCropAt(gesture.crop, naturalSize.width, naturalSize.height, aspect, nextZoom, startLocal.x, startLocal.y, nextLocal.x, nextLocal.y));
      return;
    }
    if (gestureRef.current?.kind !== "pan") beginGesture();
    const gesture = gestureRef.current;
    const point = pointersRef.current.get(event.pointerId);
    if (!point || !gesture || gesture.kind !== "pan" || gesture.pointerId !== event.pointerId) return;
    emit(panPhotoCrop(gesture.crop, naturalSize.width, naturalSize.height, aspect, point.x - gesture.start.x, point.y - gesture.start.y, bounds.width, bounds.height));
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    beginGesture();
  }

  function lostPointerCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.delete(event.pointerId);
    beginGesture();
  }

  function zoomAtCenter(nextZoom: number) {
    if (!naturalSize.width || !naturalSize.height) return;
    emit(zoomPhotoCropAt(valueRef.current, naturalSize.width, naturalSize.height, aspect, nextZoom, 0.5, 0.5));
  }

  function keyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!naturalSize.width || !naturalSize.height) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const deltas: Record<string, Point> = {
      ArrowLeft: { x: 12, y: 0 }, ArrowRight: { x: -12, y: 0 }, ArrowUp: { x: 0, y: 12 }, ArrowDown: { x: 0, y: -12 },
    };
    if (deltas[event.key]) {
      event.preventDefault();
      emit(panPhotoCrop(valueRef.current, naturalSize.width, naturalSize.height, aspect, deltas[event.key].x, deltas[event.key].y, bounds.width, bounds.height));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomAtCenter(valueRef.current.zoom * 1.25);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomAtCenter(valueRef.current.zoom / 1.25);
    }
  }

  const imageStyle = naturalSize.width && naturalSize.height
    ? photoCropImageStyle(naturalSize.width, naturalSize.height, aspect, value)
    : undefined;

  return <article className={styles.cropCard}>
    <div className={styles.cropHeading}><h3>{label}</h3><p id={descriptionId}>{description}</p></div>
    <div
      ref={surfaceRef}
      className={`${styles.cropSurface} ${round ? styles.cropSurfaceRound : ""}`}
      style={{ aspectRatio: String(aspect) }}
      role="group"
      tabIndex={0}
      aria-label={`${label}: область кадрирования`}
      aria-describedby={descriptionId}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onLostPointerCapture={lostPointerCapture}
      onKeyDown={keyDown}
      onDragStart={(event) => event.preventDefault()}
    >
      <img
        className={styles.cropImage}
        src={src}
        alt={alt}
        draggable={false}
        style={imageStyle}
        onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      />
      <span className={styles.cropMoveHint} aria-hidden="true"><Move size={17} />Перемещайте фото</span>
    </div>
    <div className={styles.cropActions} aria-label={`Управление кадрированием: ${label}`}>
      <button type="button" onClick={() => zoomAtCenter(value.zoom / 1.25)} disabled={value.zoom <= cropZoomRange.min} aria-label={`Уменьшить: ${label}`}><Minus size={18} aria-hidden="true" /><span>Уменьшить</span></button>
      <button type="button" onClick={() => emit(defaultValue)}>По центру</button>
      <button type="button" onClick={() => zoomAtCenter(value.zoom * 1.25)} disabled={value.zoom >= cropZoomRange.max} aria-label={`Увеличить: ${label}`}><Plus size={18} aria-hidden="true" /><span>Увеличить</span></button>
    </div>
  </article>;
}
