"use client";

import { TextareaHTMLAttributes, useEffect, useRef } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { maxHeight?: number };

export function AutoResizeTextarea({ maxHeight = 420, onInput, value, defaultValue, ...props }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const resize = () => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    const height = Math.min(element.scrollHeight, maxHeight);
    element.style.height = `${height}px`;
    element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  useEffect(() => { resize(); }, [value, defaultValue]);

  return <textarea {...props} ref={ref} value={value} defaultValue={defaultValue} onInput={(event) => { resize(); onInput?.(event); }} />;
}
