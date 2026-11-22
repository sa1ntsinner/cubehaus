import { useEffect, useRef, useState } from "react";

export function useProgressSize(widthOnly = false) {
  const ref = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const nextHeight = widthOnly ? 0 : height;
      setSize((previous) =>
        previous.width === width && previous.height === nextHeight
          ? previous
          : { width, height: nextHeight },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [widthOnly]);
  return { ref, ...size };
}
