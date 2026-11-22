import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import { placeZoom } from "./picture";

export type ZoomState = "open" | "closing" | null;
export const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const flightCurve = "cubic-bezier(0.16, 1, 0.3, 1)";

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
  closing,
  onClosed,
  children,
}: {
  source: RefObject<SVGSVGElement | null>;
  line: RefObject<HTMLParagraphElement | null>;
  aspect: number;
  closing: boolean;
  onClosed: () => void;
  children: ReactNode;
}) {
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
    const reduced = reducedMotion();
    const flight = reduced
      ? undefined
      : box.animate([{ transform: start }, { transform: "none" }], {
          duration: 460,
          easing: flightCurve,
        });
    const fade = reduced
      ? undefined
      : veil.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 300,
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
      { duration: 340, easing: flightCurve, fill: "forwards" },
    );
    const fade = veil.animate([{ opacity }, { opacity: 0 }], {
      duration: 240,
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
    <div data-part="picture-zoom" data-no-timer>
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
