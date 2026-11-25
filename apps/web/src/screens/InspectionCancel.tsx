import { type CSSProperties, useEffect, useRef, useState } from "react";

const HOLD_MS = 600;

export function InspectionCancel({
  label,
  onCancel,
}: {
  label: string;
  onCancel(): void;
}) {
  const press = useRef<{ id: number; timer: number } | null>(null);
  const [holding, setHolding] = useState(false);

  function release(id: number) {
    if (press.current?.id !== id) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
    setHolding(false);
  }

  useEffect(
    () => () => {
      if (press.current) window.clearTimeout(press.current.timer);
    },
    [],
  );

  return (
    <button
      type="button"
      data-action="inspection-cancel"
      data-no-timer
      data-holding={holding || undefined}
      style={{ "--cancel-hold": `${HOLD_MS}ms` } as CSSProperties}
      onPointerDown={(event) => {
        if (event.button !== 0 || press.current) return;
        press.current = {
          id: event.pointerId,
          timer: window.setTimeout(onCancel, HOLD_MS),
        };
        setHolding(true);
      }}
      onPointerMove={(event) => {
        const { left, right, top, bottom } =
          event.currentTarget.getBoundingClientRect();
        const { clientX, clientY, pointerId } = event;
        if (
          clientX < left ||
          clientX > right ||
          clientY < top ||
          clientY > bottom
        )
          release(pointerId);
      }}
      onPointerUp={(event) => release(event.pointerId)}
      onPointerCancel={(event) => release(event.pointerId)}
      onPointerLeave={(event) => release(event.pointerId)}
      onLostPointerCapture={(event) => release(event.pointerId)}
      onClick={(event) => {
        // Keyboard and assistive technology can activate the button directly.
        if (event.detail === 0) onCancel();
      }}
    >
      <span>{label}</span>
    </button>
  );
}
