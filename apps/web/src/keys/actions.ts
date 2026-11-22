import { type EventId, eventInfo, hasTimePenalty } from "@cubehaus/core";
import type { Action, KeyState } from "./engine";

// The whole table of keyboard actions
// and DESIGN.md section 18. The timer binds its start keys as physical input.
// The stop gesture always accepts any fresh key.

export interface ActionSpec {
  id: string;
  title: { en: string; ru: string };
  keys: readonly string[];
  when: readonly KeyState[];
  input?: "start" | "hand";
  forEvent?: (event: EventId) => boolean;
}

const atRest: KeyState[] = ["idle", "stopped"];

const sessionsByPosition: ActionSpec[] = Array.from({ length: 9 }, (_, i) => ({
  id: `session.${i + 1}`,
  title: { en: `Session ${i + 1}`, ru: `Сессия ${i + 1}` },
  keys: [`Alt+Digit${i + 1}`],
  when: atRest,
}));

const timingStates: KeyState[] = [...atRest, "inspecting"];
const context = (
  id: string,
  en: string,
  ru: string,
  when: KeyState,
  ...keys: string[]
): ActionSpec => ({ id, title: { en, ru }, keys, when: [when] });

export const ACTIONS: readonly ActionSpec[] = [
  {
    id: "solve.plus2",
    title: { en: "+2", ru: "+2" },
    keys: ["Digit2"],
    when: atRest,
    forEvent: hasTimePenalty,
  },
  {
    id: "solve.dnf",
    title: { en: "DNF", ru: "DNF" },
    keys: ["KeyD"],
    when: atRest,
  },
  {
    id: "solve.delete",
    title: { en: "Delete solve", ru: "Удалить сборку" },
    keys: ["Backspace", "Delete"],
    when: atRest,
  },
  {
    id: "undo",
    title: { en: "Undo", ru: "Отменить" },
    keys: ["Mod+KeyZ"],
    when: atRest,
  },
  {
    id: "solve.comment",
    title: { en: "Comment", ru: "Комментарий" },
    keys: ["KeyC"],
    when: atRest,
  },
  {
    id: "solve.earlier",
    title: { en: "Earlier solve", ru: "Предыдущая сборка" },
    keys: ["ArrowUp"],
    when: atRest,
  },
  {
    id: "solve.later",
    title: { en: "Later solve", ru: "Следующая сборка" },
    keys: ["ArrowDown"],
    when: atRest,
  },
  {
    id: "solve.selectEarlier",
    title: { en: "Select earlier solves", ru: "Выделить сборки раньше" },
    keys: ["Shift+ArrowUp"],
    when: atRest,
  },
  {
    id: "solve.selectLater",
    title: { en: "Select later solves", ru: "Выделить сборки позже" },
    keys: ["Shift+ArrowDown"],
    when: atRest,
  },
  {
    id: "solve.move",
    title: { en: "Move to another session", ru: "Перенести в другую сессию" },
    keys: ["KeyM"],
    when: atRest,
  },
  {
    id: "solve.split",
    title: { en: "Split the session here", ru: "Разделить сессию здесь" },
    keys: ["Shift+KeyS"],
    when: atRest,
  },
  {
    id: "solve.repeat",
    title: {
      en: "Solve this scramble again",
      ru: "Собрать этот скрамбл ещё раз",
    },
    keys: ["KeyR"],
    when: atRest,
    forEvent: (event) => eventInfo(event).kind === "time",
  },
  {
    id: "drill.open",
    title: { en: "Drill scrambles", ru: "Тренировочные скрамблы" },
    keys: ["KeyL"],
    when: atRest,
    forEvent: (event) => event === "333",
  },
  {
    id: "drill.solution",
    title: {
      en: "Show or hide the cross solution",
      ru: "Показать или скрыть решение креста",
    },
    keys: ["KeyV"],
    when: atRest,
    forEvent: (event) => event === "333",
  },
  {
    id: "scramble.previous",
    title: { en: "Previous scramble", ru: "Предыдущий скрамбл" },
    keys: ["ArrowLeft"],
    when: atRest,
  },
  {
    id: "scramble.next",
    title: { en: "Next scramble", ru: "Следующий скрамбл" },
    keys: ["ArrowRight"],
    when: atRest,
  },
  {
    id: "scramble.copy",
    title: { en: "Copy scramble", ru: "Скопировать скрамбл" },
    keys: ["Mod+KeyC"],
    when: atRest,
  },
  {
    id: "average.inspect",
    title: { en: "Show average attempts", ru: "Сборки в среднем" },
    keys: ["KeyA"],
    when: atRest,
    forEvent: (event) => event !== "333mbf",
  },
  context(
    "average.copy",
    "Copy average",
    "Скопировать среднее",
    "average-detail",
    "Mod+KeyC",
  ),
  context(
    "average.close",
    "Close average",
    "Закрыть среднее",
    "average-detail",
    "Escape",
  ),
  {
    id: "session.switch",
    title: { en: "Switch session", ru: "Сменить сессию" },
    keys: ["KeyS"],
    when: atRest,
  },
  {
    id: "session.previous",
    title: { en: "Previous session", ru: "Предыдущая сессия" },
    keys: ["BracketLeft"],
    when: atRest,
  },
  {
    id: "session.next",
    title: { en: "Next session", ru: "Следующая сессия" },
    keys: ["BracketRight"],
    when: atRest,
  },
  ...sessionsByPosition,
  {
    id: "session.rename",
    title: { en: "Rename session", ru: "Переименовать сессию" },
    keys: ["F2"],
    when: atRest,
  },
  {
    id: "inspection.toggle",
    title: {
      en: "Turn inspection on or off",
      ru: "Включить или выключить инспекцию",
    },
    keys: ["KeyI"],
    when: atRest,
  },
  {
    id: "entry.toggle",
    title: { en: "Enter times by hand", ru: "Ввод времени вручную" },
    keys: ["KeyE"],
    when: atRest,
  },
  {
    id: "picture.toggle",
    title: { en: "Scramble picture", ru: "Картинка скрамбла" },
    keys: ["KeyP"],
    when: ["idle"],
  },
  {
    id: "picture.zoom",
    title: { en: "Enlarge picture", ru: "Увеличить картинку" },
    keys: ["KeyF"],
    when: atRest,
  },
  {
    id: "view.fullscreen",
    title: { en: "Full screen", ru: "Во весь экран" },
    keys: ["Shift+KeyF"],
    when: atRest,
  },
  ...(["system", "dark", "light", "custom"] as const).map(
    (theme): ActionSpec => ({
      id: `theme.${theme}`,
      title: {
        system: { en: "System theme", ru: "Системная тема" },
        dark: { en: "Dark theme", ru: "Тёмная тема" },
        light: { en: "Light theme", ru: "Светлая тема" },
        custom: { en: "Custom theme", ru: "Своя тема" },
      }[theme],
      keys: [],
      when: atRest,
    }),
  ),
  {
    id: "size.larger",
    title: { en: "Larger", ru: "Крупнее" },
    keys: ["Shift+Equal", "Equal", "NumpadAdd"],
    when: atRest,
  },
  {
    id: "size.smaller",
    title: { en: "Smaller", ru: "Мельче" },
    keys: ["Minus", "NumpadSubtract"],
    when: atRest,
  },
  {
    id: "size.reset",
    title: { en: "Reset sizes", ru: "Сбросить размеры" },
    keys: [],
    when: atRest,
  },
  {
    id: "settings.open",
    title: { en: "Settings", ru: "Настройки" },
    keys: [],
    when: atRest,
  },
  {
    id: "layout.lift",
    title: { en: "Lift layout", ru: "Вид «Журнал»" },
    keys: [],
    when: atRest,
  },
  {
    id: "layout.times",
    title: { en: "Times layout", ru: "Вид «Времена»" },
    keys: [],
    when: atRest,
  },
  {
    id: "layout.focus",
    title: { en: "Focus layout", ru: "Вид «Фокус»" },
    keys: [],
    when: atRest,
  },
  {
    id: "record.toggle",
    title: { en: "Highlight records", ru: "Выделять рекорды" },
    keys: [],
    when: atRest,
  },
  {
    id: "progress",
    title: { en: "Progress", ru: "Прогресс" },
    keys: ["KeyT"],
    when: atRest,
  },
  {
    id: "help",
    title: { en: "Keys", ru: "Клавиши" },
    keys: ["Shift+Slash"],
    when: atRest,
  },
  {
    id: "palette",
    title: { en: "Commands", ru: "Команды" },
    keys: ["Mod+KeyK"],
    when: [...atRest, "typing"],
  },
  {
    id: "escape",
    title: { en: "Cancel or close", ru: "Отменить или закрыть" },
    keys: ["Escape"],
    when: ["idle", "inspecting", "stopped", "modal", "typing"],
  },
  {
    id: "timer.start",
    title: { en: "Start timer", ru: "Запуск таймера" },
    keys: ["Space"],
    when: timingStates,
    input: "start",
  },
  {
    id: "timer.handLeft",
    title: { en: "Left hand", ru: "Левая рука" },
    keys: ["ControlLeft"],
    when: timingStates,
    input: "hand",
  },
  {
    id: "timer.handRight",
    title: { en: "Right hand", ru: "Правая рука" },
    keys: ["ControlRight"],
    when: timingStates,
    input: "hand",
  },
  context(
    "zoom.close",
    "Close enlarged picture",
    "Закрыть картинку",
    "zoom",
    "KeyF",
    "Escape",
    "Space",
  ),
  context("zoom.hide", "Hide picture", "Скрыть картинку", "zoom", "KeyP"),
  context(
    "progress.close",
    "Close progress",
    "Закрыть прогресс",
    "progress",
    "KeyT",
    "Escape",
  ),
  context(
    "chart.previous",
    "Earlier chart result",
    "Предыдущий результат на графике",
    "progress-chart",
    "ArrowLeft",
  ),
  context(
    "chart.next",
    "Later chart result",
    "Следующий результат на графике",
    "progress-chart",
    "ArrowRight",
  ),
  context(
    "chart.first",
    "First chart result",
    "Первый результат на графике",
    "progress-chart",
    "Home",
  ),
  context(
    "chart.last",
    "Last chart result",
    "Последний результат на графике",
    "progress-chart",
    "End",
  ),
  context(
    "sheet.close",
    "Close session switch",
    "Закрыть список сессий",
    "sheet",
    "Escape",
  ),
  context(
    "sheet.previous",
    "Previous row",
    "Предыдущая строка",
    "sheet",
    "ArrowUp",
  ),
  context("sheet.next", "Next row", "Следующая строка", "sheet", "ArrowDown"),
  context(
    "sheet.selectPrevious",
    "Select previous session",
    "Выделить предыдущую сессию",
    "sheet",
    "Shift+ArrowUp",
  ),
  context(
    "sheet.selectNext",
    "Select next session",
    "Выделить следующую сессию",
    "sheet",
    "Shift+ArrowDown",
  ),
  context(
    "sheet.moveUp",
    "Move row up",
    "Перенести строку вверх",
    "sheet",
    "Alt+ArrowUp",
  ),
  context(
    "sheet.moveDown",
    "Move row down",
    "Перенести строку вниз",
    "sheet",
    "Alt+ArrowDown",
  ),
  context(
    "sheet.expand",
    "Open folder",
    "Открыть папку",
    "sheet",
    "ArrowRight",
  ),
  context(
    "sheet.collapse",
    "Close folder",
    "Закрыть папку",
    "sheet",
    "ArrowLeft",
  ),
  context(
    "sheet.pick",
    "Open selected row",
    "Открыть выбранную строку",
    "sheet",
    "Enter",
  ),
  context(
    "sheet.menu",
    "Session menu",
    "Меню сессии",
    "sheet",
    "ContextMenu",
    "Shift+F10",
  ),
  context(
    "sheet.rename",
    "Rename selected row",
    "Переименовать строку",
    "sheet",
    "F2",
  ),
  context(
    "sheet.archive",
    "Archive or unarchive session",
    "Переместить сессию в архив или вернуть",
    "sheet",
    "Mod+Backspace",
  ),
  context(
    "sheet.group",
    "Group session in a folder",
    "Поместить сессию в папку",
    "sheet",
    "Mod+Shift+KeyN",
  ),
  context(
    "sheet.undo",
    "Undo session change",
    "Отменить изменение сессии",
    "sheet",
    "Mod+KeyZ",
  ),
  context(
    "sheet.eventNext",
    "Next puzzle for new session",
    "Следующая головоломка для новой сессии",
    "sheet",
    "Tab",
  ),
  context(
    "sheet.eventPrevious",
    "Previous puzzle for new session",
    "Предыдущая головоломка для новой сессии",
    "sheet",
    "Shift+Tab",
  ),
  context(
    "sheet-menu.previous",
    "Previous menu action",
    "Предыдущее действие в меню",
    "sheet-menu",
    "ArrowLeft",
    "ArrowUp",
  ),
  context(
    "sheet-menu.next",
    "Next menu action",
    "Следующее действие в меню",
    "sheet-menu",
    "ArrowRight",
    "ArrowDown",
  ),
  context(
    "sheet-rename.save",
    "Save session name",
    "Сохранить название сессии",
    "sheet-rename",
    "Enter",
  ),
  context(
    "sheet-rename.cancel",
    "Cancel session rename",
    "Отменить переименование",
    "sheet-rename",
    "Escape",
  ),
  context(
    "palette.previous",
    "Previous command",
    "Предыдущая команда",
    "palette-view",
    "ArrowUp",
  ),
  context(
    "palette.next",
    "Next command",
    "Следующая команда",
    "palette-view",
    "ArrowDown",
  ),
  context(
    "palette.run",
    "Run selected command",
    "Выполнить выбранную команду",
    "palette-view",
    "Enter",
  ),
  context(
    "palette.close",
    "Close commands",
    "Закрыть список команд",
    "palette-view",
    "Escape",
  ),
  context(
    "entry.submit",
    "Save or check entry",
    "Сохранить или проверить результат",
    "entry",
    "Enter",
  ),
  context(
    "entry.discard",
    "Discard the attempt",
    "Удалить попытку",
    "entry",
    "Escape",
  ),
  context(
    "stat-picker.previous",
    "Previous statistic",
    "Предыдущий показатель",
    "stat-picker",
    "ArrowUp",
  ),
  context(
    "stat-picker.next",
    "Next statistic",
    "Следующий показатель",
    "stat-picker",
    "ArrowDown",
  ),
  context(
    "stat-picker.close",
    "Close statistic choices",
    "Закрыть выбор показателя",
    "stat-picker",
    "Escape",
  ),
  context(
    "settings.close",
    "Close settings",
    "Закрыть настройки",
    "settings",
    "Escape",
  ),
];

export function actionsForEvent(event: EventId): readonly ActionSpec[] {
  return ACTIONS.filter((spec) => spec.forEvent?.(event) ?? true);
}

// Attach what each action does. An action without a handler runs `notYet`,
// so a key never silently does nothing.
export function bindActions(
  handlers: Partial<Record<string, () => void | Promise<void>>>,
  notYet: (spec: ActionSpec) => void,
  specs: readonly ActionSpec[] = ACTIONS,
): Action[] {
  return specs.map((spec) => ({
    ...spec,
    run: handlers[spec.id] ?? (() => notYet(spec)),
  }));
}
