/**
 * Test hooks only: `?now=2026-11-22T12:00` moves the page's clock to that local time and
 * lets it run on from there, so screens dated from today (the progress calendar, the
 * target's estimate) look the same on any day. Dates built from a value are untouched.
 */
export function pinClock(search: string): void {
  const value = new URLSearchParams(search).get("now");
  if (!value) return;
  const RealDate = Date;
  const pinned = new RealDate(value).getTime();
  if (Number.isNaN(pinned)) return;
  const offset = pinned - RealDate.now();
  const now = () => RealDate.now() + offset;
  // A subclass keeps `instanceof Date`, parsing, UTC and every method as they are.
  class PinnedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(now());
      else super(...(args as [string]));
    }
    static override now() {
      return now();
    }
  }
  globalThis.Date = PinnedDate as DateConstructor;
}
