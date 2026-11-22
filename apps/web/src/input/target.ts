export function isInteractive(target: EventTarget | null): boolean {
  let current = target;
  while (current) {
    const element = current as EventTarget & {
      tagName?: string;
      isContentEditable?: boolean;
      parentElement?: EventTarget | null;
      hasAttribute?: (name: string) => boolean;
    };
    if (
      element.isContentEditable ||
      element.hasAttribute?.("data-no-timer") ||
      /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(
        element.tagName?.toUpperCase() ?? "",
      )
    )
      return true;
    current = element.parentElement ?? null;
  }
  return false;
}

export function isNoTimer(target: EventTarget | null): boolean {
  let current = target;
  while (current) {
    const element = current as EventTarget & {
      parentElement?: EventTarget | null;
      hasAttribute?: (name: string) => boolean;
    };
    if (element.hasAttribute?.("data-no-timer")) return true;
    current = element.parentElement ?? null;
  }
  return false;
}

export function isTyping(target: EventTarget | null): boolean {
  const element = target as
    | (EventTarget & {
        tagName?: string;
        type?: string;
        isContentEditable?: boolean;
      })
    | null;
  return (
    !!element &&
    (element.isContentEditable === true ||
      element.tagName === "TEXTAREA" ||
      element.tagName === "SELECT" ||
      (element.tagName === "INPUT" &&
        !/^(button|checkbox|file|radio|range|reset|submit)$/.test(
          element.type ?? "",
        )))
  );
}
