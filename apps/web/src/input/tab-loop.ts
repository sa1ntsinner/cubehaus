import type { FocusEvent } from "react";

const STOPS =
  'a[href], button:enabled, input:enabled, select:enabled, textarea:enabled, [tabindex]:not([tabindex="-1"])';

/**
 * A sheet that covers the page keeps Tab inside it: past its last control the keyboard
 * comes round to its first, and back, never onto the page it covers. Escape leaves the
 * sheet. Goes on the sheet's `onBlur`.
 */
export function keepFocusInside(event: FocusEvent<HTMLElement>) {
  const sheet = event.currentTarget;
  const next = event.relatedTarget;
  if (!(next instanceof Node) || sheet.contains(next)) return;
  const stops = [...sheet.querySelectorAll<HTMLElement>(STOPS)].filter(
    (stop) => stop.getClientRects().length > 0,
  );
  const after =
    sheet.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING;
  ((after ? stops[0] : stops[stops.length - 1]) ?? sheet).focus();
}
