import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import { keepFocusInside } from "../input/tab-loop";
import { placeZoom } from "./picture";

export type ZoomState = "open" | "closing" | null;
export const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Open: a short spring that settles a hair past its size; close: straight back.
const springCurve = "cubic-bezier(0.34, 1.32, 0.64, 1)";
const returnCurve = "cubic-bezier(0.3, 0, 0.2, 1)";
const flightMs = 220;

type Placement = ReturnType<typeof placeZoom>;

function transformTo(source: SVGSVGElement, placement: Placement) {
  const rect = source.getBoundingClientRect();
  const { left, top, width } = placement;
  return `translate(${rect.left - left}px, ${rect.top - top}px) scale(${width > 0 ? rect.width / width : 1})`;
}

export function PictureZoom({
  source,
  line,
  aspect,
  label,
  closing,
  onClosed,
  children,
}: {
  source: RefObject<SVGSVGElement | null>;
  line: RefObject<HTMLParagraphElement | null>;
  aspect: number;
  label: string;
  closing: boolean;
  onClosed: () => void;
  children: ReactNode;
}) {
  const zoomRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    zoomRef.current?.focus({ preventScroll: true });
  }, []);

  const veilRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const placementRef = useRef<Placement>(null);

  useLayoutEffect(() => {
    const drawing = source.current;
    const scramble = line.current;
    const box = boxRef.current;
    const veil = veilRef.current;
    if (!drawing || !scramble || !box || !veil) return;
    const place = () => {
      const placement = placeZoom(
        window.innerWidth,
        window.innerHeight,
        aspect,
        scramble.getBoundingClientRect().bottom,
      );
      placementRef.current = placement;
      Object.assign(box.style, {
        left: `${placement.left}px`,
        top: `${placement.top}px`,
        width: `${placement.width}px`,
        height: `${placement.height}px`,
      });
      return placement;
    };
    const placement = place();
    const start = transformTo(drawing, placement);
    drawing.style.visibility = "hidden";
    // Reduced motion: no flight and no scale, the large picture fades in where it stands.
    const flight = reducedMotion()
      ? box.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 160,
          easing: "ease-out",
        })
      : box.animate([{ transform: start }, { transform: "none" }], {
          duration: flightMs,
          easing: springCurve,
        });
    const fade = veil.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 180,
      easing: "ease-out",
    });
    const observer = new ResizeObserver(place);
    observer.observe(scramble);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      flight?.cancel();
      fade?.cancel();
      drawing.style.visibility = "";
    };
  }, [source, line, aspect]);

  useLayoutEffect(() => {
    if (!closing) return;
    const drawing = source.current;
    const placement = placementRef.current;
    const box = boxRef.current;
    const veil = veilRef.current;
    if (!drawing || !placement || !box || !veil || reducedMotion()) {
      onClosed();
      return;
    }

    const transform = getComputedStyle(box).transform;
    const opacity = getComputedStyle(veil).opacity;
    for (const animation of [...box.getAnimations(), ...veil.getAnimations()])
      animation.cancel();
    const flight = box.animate(
      [{ transform }, { transform: transformTo(drawing, placement) }],
      { duration: flightMs, easing: returnCurve, fill: "forwards" },
    );
    const fade = veil.animate([{ opacity }, { opacity: 0 }], {
      duration: 200,
      easing: "ease-in",
      fill: "forwards",
    });
    void flight.finished.then(onClosed, () => {});
    return () => {
      flight.cancel();
      fade.cancel();
    };
  }, [closing, onClosed, source]);

  return (
    <div
      ref={zoomRef}
      data-part="picture-zoom"
      data-no-timer
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onBlur={keepFocusInside}
      onKeyDown={(event) => {
        // The drawing has no controls to move to.
        if (event.key === "Tab") event.preventDefault();
      }}
    >
      <div
        ref={veilRef}
        data-part="picture-veil"
        style={{ position: "fixed", inset: 0 }}
      />
      <div
        ref={boxRef}
        data-part="picture-zoom-box"
        style={{ position: "fixed", transformOrigin: "0 0" }}
      >
        {children}
      </div>
    </div>
  );
}
