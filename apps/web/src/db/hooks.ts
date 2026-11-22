export function readTestHooks(search: string): {
  delay: number;
  drop: boolean;
} {
  if (import.meta.env.VITE_TEST_HOOKS !== "1") return { delay: 0, drop: false };
  const params = new URLSearchParams(search);
  const delay = Number(params.get("dbDelay"));
  return {
    delay: Number.isFinite(delay) && delay > 0 ? delay : 0,
    drop: params.get("dbDrop") === "1",
  };
}
