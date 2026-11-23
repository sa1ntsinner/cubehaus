import { EVENTS, eventInfo, type RoundFormat } from "@cubehaus/core";
import type { ImportFormatProblem } from "@cubehaus/importers";
import type { CsvIssueCode } from "./import";

const en = {
  language: "en" as "en" | "ru",
  events: EVENTS,
  defaultSession: eventInfo("333").label,
  noScramble: "No scramble",
  pictureEnlarge: "Enlarge the scramble picture",
  retry: "Retry",
  sessions: "Sessions",
  newSession: "New session",
  renameSession: "Rename session",
  sessionActions: "Session actions",
  deleteSession: "Delete session",
  sessionName: "Session name",
  event: "Event",
  save: "Save",
  cancel: "Cancel",
  comment: "Comment",
  commentPrefix: "// ",
  solveNo: (n: number) => `No. ${n}`,
  repeat: {
    action: "Again",
    of: (n: number) => `No. ${n} again`,
    leave: "Back to new scrambles",
    attempts: "Attempts on this scramble",
    count: (n: number) => `${n} attempts`,
    first: "This is the first attempt",
    last: "This is the last attempt",
  },
  noSolve: "No solve yet",
  noEarlier: "No earlier solve",
  noEarlierScramble: "No earlier scramble",
  solveHistory: "Solve history",
  averageDetail: {
    inspect: "Show attempts",
    inspectBest: "Show best window",
    loading: "Loading attempts…",
    unavailable: "These attempts are unavailable.",
    previous: "Previous attempts",
    next: "Next attempts",
    copy: "Copy average",
    copied: "Average copied",
    fallback: "Copy the selected text",
  },
  earlierSolve: "Earlier solve",
  laterSolve: "Later solve",
  previousScramble: "Previous scramble",
  nextScramble: "Next scramble",
  scrambleCopied: "Scramble copied",
  scrambleCopyFailed: "Could not copy scramble",
  noLater: "This is the newest solve",
  movedTo: (n: number, name: string) =>
    n === 1 ? `Moved to ${name}` : `${n} solves moved to ${name}`,
  notMoved: {
    missing: "Not moved: a solve is no longer here.",
    destination: "Not moved: that session is gone.",
    event: "Not moved: that session is another puzzle.",
    changed: "Not moved: the solves changed meanwhile. Try again.",
  },
  moveCount: (n: number) => `Move ${n}`,
  splitHere: "Split here",
  splitName: (name: string, at: number) =>
    `${name} until ${dayOf("en-GB", at)}`,
  splitDone: (n: number, name: string) =>
    n === 1
      ? `1 earlier solve is now in ${name}`
      : `${n} earlier solves are now in ${name}`,
  notSplit: {
    missing: "Not split: that solve is no longer here.",
    first: "No earlier solve",
    changed: "Not split: the solves changed meanwhile. Try again.",
    gone: "Not split.",
  },
  deleteCount: (n: number) => `Delete ${n}`,
  clearSelection: "Cancel",
  moreSolves: "Load more solves",
  penaltyOk: "OK",
  penaltyPlus2: "+2",
  penaltyDnf: "DNF",
  // The status line's action (DESIGN.md section 17): the solve is the one on screen.
  deleteSolve: "Delete",
  undo: "Undo",
  stats: "Session statistics",
  chooseStat: "Choose statistic",
  customAverage: "Custom average",
  averageLength: "Number of solves",
  averageLengthError: "Enter a whole number of at least 5",
  resetAverages: "Reset averages",
  count: "Count",
  best: "best",
  mean: "mean",
  ao5: "ao5",
  ao12: "ao12",
  mo3: "mo3",
  ao100: "ao100",
  undoSession: "Delete session",
  undoArchive: "Archive session",
  undoOrder: "Session order",
  undoPenalty: "Change penalty",
  undoComment: "Change comment",
  undoSolve: "Delete solve",
  undoSolves: "Delete solves",
  undoMove: "Move solves",
  undoMerge: "Merge sessions",
  undoSplit: "Split session",
  timer: "Timer",
  // The way back from Progress, Settings, the palette and the key list.
  backToTimer: "Timer",
  // Dates and counts on screen (Intl locale).
  locale: "en-GB",
  train: {
    title: "Algorithms",
    // The status line's word on the narrowest phones, where the session's name needs room.
    short: "Algs",
    modes: { learn: "Learn", drill: "Drill", review: "Review" },
    all: "All",
    none: "None",
    twoLook: "2-look",
    // The other puzzle, one word at the bar's far end.
    puzzles: { "333": "3×3", "222": "2×2" },
    puzzleNames: { "333": "3×3 cube", "222": "2×2 cube" },
    // F2L's slot, as cubers write it.
    slots: { fr: "FR", fl: "FL", br: "BR", bl: "BL" },
    slotNames: {
      fr: "Front right slot",
      fl: "Front left slot",
      br: "Back right slot",
      bl: "Back left slot",
    },
    add: "Add to drills",
    remove: "Take out of drills",
    moves: (n: number) => `${n} ${n === 1 ? "move" : "moves"}`,
    picture: "Picture",
    scramble: "Scramble",
    nothing: "Nothing to drill yet. Add cases in Learn.",
    drillAll: "Drill every case",
    mine: "Mine",
    everyCase: "All",
    noWeak:
      "Nothing to review now. A case comes here when it is due, slow against your others, or missed twice in five.",
    // What Review holds today, said once before its first case.
    today: ({
      due,
      slow,
      missed,
    }: {
      due: number;
      slow: number;
      missed: number;
    }) =>
      [
        due > 0 && `${due} due`,
        slow > 0 && `${slow} slow`,
        missed > 0 && `${missed} missed`,
      ]
        .filter(Boolean)
        .join(", "),
    noAlg: "No algorithm yet.",
    more: (n: number) => `${n} more`,
    use: "Use",
    preparing: "// preparing a scramble",
    recognition: "recognition",
    median: "median",
    next: "Next",
    missed: "Missed",
    afterKeys: "Space next · M missed",
    back: "Cases",
    // A quiet choice at the drill's foot: the first press marks the case recognised.
    split: "Split",
    execution: "execution",
    splitHint: {
      pictureKey: "Space when you know the case, again to stop",
      pictureTouch: "Tap when you know the case, again to stop",
      scrambleKey: "Hold Space, let go, Space once you know the case",
      scrambleTouch: "Hold, let go, tap once you know the case",
    },
    keys: [
      ["Space", "Hold, let go: start"],
      ["Space", "Split: the case is recognised"],
      ["Space", "Stop"],
      ["Space Enter", "Next case"],
      ["KeyM", "Missed"],
      ["Escape", "Back"],
      ["Shift+Slash", "Keys"],
    ] as readonly (readonly [string, string])[],
  },
  progress: {
    // DESIGN.md section 14, the calm view: names, numbers and the trend, no sentences.
    title: "Progress",
    solves: "Solves",
    // The signed differences after the current average.
    since: { 30: "30 d", 365: "1 y", best: "best" } as Record<
      30 | 365 | "best",
      string
    >,
    single: "single",
    days: "days",
    run: "in a row",
    needs: (n: number) => `An average needs ${n} solves.`,
    none: "No solves yet.",
    solveAt: (solve: string, date: string) => `Solve ${solve} · ${date}`,
    trend: (average: string, from: string, to: string) =>
      `${average} trend, from ${from} to ${to}`,
    calendar: "Days with solves",
    today: "today",
    distribution: "Distribution",
    dnf: "DNF",
    mean: "mean",
    solveCount: (n: number) =>
      `${n.toLocaleString("en-GB")} ${n === 1 ? "solve" : "solves"}`,
    dayCount: (n: number) => `${n} ${n === 1 ? "day" : "days"}`,
    noSolves: "no solves",
    target: {
      title: "Target",
      input: "Under",
      under: (time: string) => `Under ${time}`,
      about: (date: string) => `about ${date}`,
      perDay: (change: string) => `${change} a day`,
      perWeek: (change: string) => `${change} a week`,
      perMonth: (change: string) => `${change} a month`,
      basis: (days: number, solves: number) =>
        `from ${days} ${days === 1 ? "day" : "days"}, ${solves.toLocaleString("en-GB")} ${solves === 1 ? "solve" : "solves"}`,
      reasons: {
        already: "already under it",
        sparse: "needs 7 days of 5 solves in the last 90",
        flat: "no change lately",
        stale: "no practice in 30 days",
        rising: "slower lately",
        distant: "more than a year away",
      },
    },
    loading: "Loading progress…",
    failed: "Progress could not be loaded.",
    scope: {
      options: "Scope and averages",
      scope: "Scope",
      session: "One session",
      folder: "Folder",
      selection: "Selected sessions",
      puzzle: "Puzzle",
      average: "Average",
      auto: "Automatic",
      count: (n: number) =>
        `${n.toLocaleString("en-GB")} ${n === 1 ? "solve" : "solves"}`,
    },
  },
  updateReady: "A new version is ready.",
  updateAction: "Update",
  updateFailed:
    "The update could not be installed. This version keeps working.",
  dbMemory: "Solves are kept only until this tab closes.",
  dbEarlier:
    "Solves from the earlier version are kept apart. Settings › Data can add them.",
  unsaved: (n: number) =>
    n === 1
      ? "1 solve is not saved anywhere: the browser refused to store it."
      : `${n} solves are not saved anywhere: the browser refused to store them.`,
  unsavedDownload: "Download",
  dbBusy:
    "Open in another tab. Solves made here are saved when that tab closes.",
  dbFailed:
    "The database could not be opened or written. Solves made here wait in this browser and are saved when it opens.",
  // Official terms (WCA Regulations; research A2) and DESIGN.md section 17.
  inspection: "Inspection",
  calls: { 8: "8 seconds", 12: "12 seconds" } as Record<8 | 12, string>,
  formats: {
    ao5: "Average of 5",
    mo3: "Mean of 3",
    bo1: "Best of 1",
    bo2: "Best of 2",
    bo3: "Best of 3",
    bo5: "Best of 5",
  } as Record<RoundFormat, string>,
  scramble: "Scramble",
  attempt: "Attempt",
  penalty: "Penalty",
  empty: "No solves yet",
  emptyHintKey: "Hold Space, let go to start",
  leftHand: "Left Ctrl",
  rightHand: "Right Ctrl",
  emptyHintTouch: "Hold the screen, let go to start",
  /** The start keys when they are not Space alone. */
  emptyHintKeys: (keys: string) => `Hold ${keys}, let go to start`,
  emptyHintHands: "Hold both keys, let go to start",
  /** The first visit's empty file: where old solves come in. */
  emptyImport: "Solves from another timer:",
  drill: {
    title: "Drill scrambles",
    kind: {
      official: "Official 3×3",
      "easy-cross": "Cross in a few turns",
      "easy-xcross": "Xcross in a few turns",
      "cross-solved": "Cross solved",
      "edges-only": "Edges only",
      "corners-only": "Corners only",
      "two-gen": "R and U only",
      oll: "OLL cases",
      pll: "PLL cases",
      coll: "COLL cases",
      ll: "Last-layer cases",
    },
    turns: "Turns",
    cross: "Cross",
    colour: {
      U: "white",
      D: "yellow",
      F: "green",
      B: "blue",
      R: "red",
      L: "orange",
    },
    crossIn: (n: number, colour: string) =>
      `${colour} cross in ${n} ${n === 1 ? "turn" : "turns"}`,
    xcrossIn: (n: number, colour: string) =>
      `${colour} xcross in ${n} ${n === 1 ? "turn" : "turns"}`,
    crossSolvedOn: (colour: string) => `${colour} cross solved`,
    edgesOnly: "edges only",
    cornersOnly: "corners only",
    twoGen: "R and U only",
    cases: (set: string, n: number) =>
      n === 0
        ? `${set}: no case picked`
        : `${set}, ${n} ${n === 1 ? "case" : "cases"}`,
    line: "Drill",
    change: "Change",
    find: "Find a case",
    all: "All",
    none: "None",
    pickOne: "Pick at least one case.",
    group: { cross: "Cross", dot: "Dot", line: "Line", L: "L" },
    solution: "Solution",
    hide: "Hide",
    searching: "searching",
    notFound: "none within 14 turns",
    failed: "Not found.",
    retry: "Try again",
    slotOf: (slot: string) => `${slot} slot`,
    solved: "already solved",
    open: "Drill scrambles",
    showSolution: "Show the cross solution",
    setting: "Scrambles",
    official: "Official",
  },
  waiting: (event: string) => `// preparing a ${event} scramble`,
  toGo: (n: number) => `in ${n}`,
  themeEditor: {
    title: "Custom theme",
    base: "Based on",
    token: {
      ground: "Ground",
      ink: "Text",
      dim: "Secondary text",
      gutter: "Muted text",
      line: "Highlight",
      prime: "Prime moves",
      double: "Double moves",
      wide: "Wide moves",
      warn: "+2 and warnings",
      error: "DNF and errors",
      pb: "Records",
    },
    picture: "Background picture",
    choose: "Choose",
    remove: "Remove",
    strength: "Picture strength",
    file: "Theme file",
    export: "Export",
    import: "Import",
    resetColours: "Reset colours",
    unreadable: (list: string) =>
      `Hard to read: ${list}. The last readable colours stay on.`,
    pictureRefused:
      "Choose a PNG, JPEG or WebP picture up to 2 MB and 4096 px.",
    importRefused: "Not a cubehaus theme.",
    saveFailed: "Could not save the theme.",
  },
  sizes: {
    title: "Sizes",
    part: {
      scramble: "Scramble",
      picture: "Picture",
      time: "Time",
      averages: "Averages",
      times: "Times",
    },
    note: (part: string, percent: number) => `${part} ${percent} %`,
    where: "Point at what to resize",
    reset: "Reset sizes",
    resetDone: "Sizes reset",
  },
  inspectionOn: "Inspection on",
  inspectionOff: "Inspection off",
  inspectionCancelled: "Inspection cancelled",
  tooShort: "Under 0.06 s: not a solve. Try again",
  plus2Sum: (raw: string, added: number, result: string) =>
    `Hatched: ${raw} + ${added} = ${result}`,
  inspectionPenalty: (penalty: "+2" | "DNF", seconds: string) =>
    `${penalty}: inspection ran ${seconds} s`,
  handPlus2: "+2 set by hand",
  dnfAt: (raw: string) => `DNF. Stopped at ${raw}`,
  entry: {
    mode: "Result entry",
    typing: "Typing",
    solution: "Solution",
    time: "Time",
    attempted: "Cubes attempted",
    solved: "Cubes solved",
    scrambles: "Show scrambles",
    check: "Check solution",
    startClock: "Start clock",
    invalidTime: "Enter a valid positive time, such as 12.34.",
    invalidCount: "Enter a whole number from zero to the number attempted.",
    invalidAttempted: "Enter at least two cubes.",
    invalidMove: (move: string) => `Invalid move: ${move}`,
    unsolved: "Solution does not solve the cube",
    checkFailed: "The solution could not be checked. Try again.",
  },
  fmcHint: "Type the number of moves, Enter. D: DNF",
  fmcOver: "Over 80 moves: DNF",
  mbfHint: (cubes: number) =>
    `How many of the ${cubes} cubes are solved? Enter. Esc removes the attempt`,
  mbfPoints: (points: number) =>
    `${points} ${points === 1 ? "point" : "points"}`,
  mbfDnf: "DNF: fewer than 2 solved, or more unsolved than solved",
  notYet: (title: string) => `${title}: not yet`,
  paletteTitle: "Commands",
  palettePlaceholder: "Type a command",
  keysTitle: "Keys",
  switcher: {
    query: "Find or create",
    create: (name: string) => `Create “${name}”`,
    rename: "Rename",
    delete: "Delete",
    event: (label: string) => `Event: ${label}. Next event`,
    folder: "Folder",
    newFolder: "New folder",
    moveOut: "Out of folder",
    folderActions: "Folder actions",
    moved: "Order changed.",
    undo: "Undo",
    archive: "Archive",
    unarchive: "Unarchive",
    archived: "Archived.",
    unarchived: "Back in the list.",
    archivedMark: "archived",
    trashed: "In the trash for 30 days.",
    archiveView: "Archive",
    trashView: "Trash",
    back: "Back to sessions",
    restored: (name: string) => `Restored: ${name}`,
    trashEmpty: "The trash is empty.",
    trashNote:
      "Deleted sessions and solves stay here for 30 days. Pick one to put it back.",
    solves: (n: number) => `${n} ${n === 1 ? "solve" : "solves"}`,
    left: (span: string) => `${span} left`,
    restore: (name: string, left: string) => `Restore ${name}. ${left}`,
    moveTitle: "Move solves",
    moveQuery: (n: number) =>
      n === 1 ? "Move this solve to…" : `Move ${n} solves to…`,
    moveNone: (event: string) =>
      `No other ${event} session yet. Type a name to make one.`,
    merge: "Merge",
    mergeTitle: "Merge sessions",
    mergeQuery: (names: readonly string[]) =>
      names.length === 1
        ? `Merge “${names[0]}” into…`
        : `Merge ${names.length} sessions into…`,
    mergePicked: (n: number) => (n === 1 ? "Merge into…" : `Merge ${n} into…`),
    mergeNone: (event: string) => `No other ${event} session to merge into.`,
    merged: (name: string) => `Merged into “${name}”.`,
    notMerged: {
      missing: "Not merged: a session is no longer here.",
      target: "Not merged: that session is gone.",
      event: "Only sessions of one puzzle merge.",
      changed: "Not merged: a session changed meanwhile. Try again.",
      gone: "Not merged.",
      nothing: "Not merged.",
    } as Record<
      "missing" | "target" | "event" | "changed" | "gone" | "nothing",
      string
    >,
  },
  settings: {
    data: "Data",
    backup: "All data as one file",
    backupSave: "Save",
    backupFailed: "The file could not be saved.",
    restore: "Restore from a file",
    restoreChoose: "Choose",
    restoring: "Restoring…",
    restored: (r: { inserted: number; updated: number; unchanged: number }) =>
      `Restored: ${r.inserted} added, ${r.updated} updated, ${r.unchanged} already here.`,
    restoreProblem: {
      format: "This file is not a cubehaus backup. Nothing was changed.",
      newer:
        "This backup comes from a newer cubehaus. Update the app, then restore it.",
      reference:
        "The backup is damaged: some solves have no session in it. Nothing was changed.",
    } as Record<"format" | "newer" | "reference", string>,
    restoreFailed: "Restoring failed. Nothing was changed.",
    earlier: "Solves from the earlier version",
    earlierAdd: "Add",
    earlierAdded: "Added. Where both had a row, the newer edit stays.",
    earlierFailed: "They could not be read. Nothing was changed.",
    backups: "Backups",
    backupFolder: "Folder",
    backupFolderChange: "Change",
    backupFolderFailed: "That folder could not be used.",
    backupLast: "Newest copy",
    backupNone: "None yet",
    backupNow: "Copy now",
    backupRetry: "Try again",
    backupDone: "Copied.",
    backupError: (reason: string) => `The last copy failed: ${reason}`,
    backupRestore: "Restore",
    backupConfirm: (when: string) =>
      `Replace the history with the copy of ${when}? The current history is copied first.`,
    backupCancel: "Cancel",
    importFrom: "Solves from another timer",
    importOneKind: "Choose one file, or CubeTime’s CSV files.",
    importCsvPenalties:
      "CubeTime’s CSV keeps no +2 or DNF. Its export for csTimer keeps them.",
    importCsvZone: (zone: string) =>
      `Times without a zone are read as ${zone}.`,
    importCsvRows: (
      name: string,
      rows: number[],
      code: CsvIssueCode,
      puzzle?: string,
    ) =>
      `“${name}”${aside(puzzle)}: ${rowList(rows, "row", "rows", "and", (n) => `${n} more`)} ${rows.length === 1 ? "stays" : "stay"} out. ${
        {
          "invalid-time": "The time can’t be read.",
          "invalid-date": "The date can’t be read.",
          "ambiguous-local-date":
            "That hour came twice when the clocks went back.",
          "nonexistent-local-date":
            "That hour was skipped when the clocks went forward.",
          "missing-dnf-time": "A DNF in CSV keeps no time.",
          "ambiguous-plus2": "A +2 in CSV can’t be split from the time.",
        }[code]
      }`,
    importChoose: "Choose",
    importReading: "Reading the file…",
    importing: "Importing…",
    importFailed: "The import could not finish. Nothing was changed.",
    importProblem: {
      json: "This file can’t be read. Choose the file csTimer exports.",
      object: "This file has no csTimer sessions.",
      sessions: "This file has no csTimer sessions.",
      "cubetime-csv":
        "This file can’t be read as a CubeTime CSV. Check the header and quoting.",
      "cubetime-selection":
        "Choose CSV files with distinct filenames and give each session a name.",
      "twisty-backup":
        "This Twisty Timer backup can’t be read. Nothing was imported.",
      cubedesk: "This CubeDesk export can’t be read. Nothing was imported.",
      "unsupported-shape":
        "cubehaus can’t read this file. It reads csTimer exports, CubeTime’s CSV files, Twisty Timer backups and CubeDesk exports.",
    } as Record<ImportFormatProblem, string>,
    importSessions: "Sessions in the file",
    importConfirm: (n: number, penalized = 0) =>
      n > 0
        ? `Import ${n} ${n === 1 ? "solve" : "solves"}`
        : penalized > 0
          ? `Add ${penalized} ${penalized === 1 ? "penalty" : "penalties"}`
          : "Import the sessions",
    importCancel: "Cancel",
    importClose: "Close",
    importHere: (n: number) =>
      n === 1 ? "1 of them is already here." : `${n} of them are already here.`,
    importAllHere: (n: number) =>
      n === 1
        ? "This solve is already here."
        : `All ${n} solves are already here.`,
    importPenalized: (n: number) =>
      `${n} of them ${n === 1 ? "gets" : "get"} the +2 or DNF the CSV left out.`,
    exportCsTimer: "Solves for csTimer",
    exportCsv: "Solves as a table",
    exported: (r: { solves: number; fields: string[] }) =>
      r.solves === 0
        ? "Saved."
        : `Saved. For ${r.solves} ${r.solves === 1 ? "solve" : "solves"} the file leaves out ${joinList(
            lost(r.fields, {
              started_at: "the date’s milliseconds",
              inspection_ms: "inspection times",
              moves: "move counts",
              solution: "solutions",
              cubes_solved: "cube counts",
              cubes_attempted: "cube counts",
              import_extra: "split times",
            }),
            "and",
          )}. “All data as one file” keeps everything.`,
    importUnknownEvent: (
      name: string,
      type: string | undefined,
      from: string,
    ) =>
      type
        ? `“${name}” becomes a 3×3 session: cubehaus has no puzzle for ${from}’s “${type}”.`
        : `“${name}” names no puzzle, so it becomes a 3×3 session.`,
    importMissingSession: (name: string, puzzle?: string) =>
      `“${name}”${aside(puzzle)} is not among the file’s sessions: its solves come in under that name.`,
    importUnreadRows: (name: string, rows: number[], puzzle?: string) =>
      `“${name}”${aside(puzzle)}: ${rowList(rows, "row", "rows", "and", (n) => `${n} more`)} can’t be read and will stay out.`,
    imported: (r: {
      added: number;
      skipped: number;
      created: number;
      penalized?: number;
    }) => {
      const penalized = r.penalized ?? 0;
      const result =
        r.added > 0
          ? `Added ${r.added} ${r.added === 1 ? "solve" : "solves"}.${r.skipped > 0 ? ` ${r.skipped} ${r.skipped === 1 ? "was" : "were"} already here.` : ""}`
          : r.skipped > 0 && penalized === 0
            ? `Nothing new: ${r.skipped} ${r.skipped === 1 ? "solve was" : "solves were"} already here.`
            : r.created > 0
              ? `Added ${r.created} ${r.created === 1 ? "session" : "sessions"} with no solves.`
              : penalized === 0
                ? "Nothing new."
                : "";
      if (penalized === 0) return result;
      const penalties = `Added ${penalized} ${penalized === 1 ? "penalty" : "penalties"}.`;
      return result ? `${result} ${penalties}` : penalties;
    },
    theme: "Theme",
    themeChoices: {
      system: "System",
      dark: "Dark",
      light: "Light",
      custom: "Custom",
    },
    title: "Settings",
    language: "Language",
    languages: { en: "English", ru: "Русский" },
    inspection: "Inspection in this session",
    inspectionChoices: {
      official: "15 seconds, as in competition",
      off: "Off",
    },
    calls: "Calls at 8 and 12 seconds",
    callChoices: { tick: "Tick", voice: "Voice", off: "Off" },
    keysTitle: "Shortcuts",
    keysChange: "Change",
    keysRemove: "Unbind",
    keysReset: "Reset",
    keysAll: "All shortcuts",
    keysOpen: "Open",
    keysDone: "Done",
    keysPress: "Press a key",
    keysCancel: "Capture cancelled",
    keysUnbound: "Unbound",
    keysReserved: "Reserved by the system or browser",
    keysInvalid: "Choose a different key",
    keysFailed: "Could not save shortcuts",
    keysConflict: (binding: string, names: string) =>
      `${binding} is used by ${names}`,
    startMode: "Start key",
    startSpace: "Space",
    startTwoHand: "Two hands",
    holdMs: "Hold before start",
    holdValue: (ms: number) => `${(ms / 1000).toFixed(2)} s`,
    running: "Time while solving",
    runningChoices: {
      tenths: "Tenths",
      hundredths: "Hundredths",
      seconds: "Seconds",
      hidden: "Hidden",
    },
    precision: "Decimal places",
    holdingTop: "Colour on top",
    holdingFront: "Colour in front",
    layout: "Timer layout",
    layouts: { lift: "Lift", times: "Times", focus: "Focus" },
    recordCue: "Highlight records",
    recordCueChoices: { on: "On", off: "Off" },
    today: "Solves today",
    awake: "Keep the screen on",
    entry: "Result entry in this session",
  },
  officialFrom: (date: string) => `official from ${date}`,
  officialUntil: (date: string) => `official until ${date}`,
};

export type Text = typeof en;

// Russian forms: 1 сборка, 2 сборки, 5 сборок; 21 сборка, 11 сборок.
/** The words for the fields a file left out, each once, in the given order. */
function lost(fields: readonly string[], words: Record<string, string>) {
  return [
    ...new Set(
      Object.keys(words)
        .filter((field) => fields.includes(field))
        .map((field) => words[field] as string),
    ),
  ];
}

/** "18 Nov", with the year when it is not this one. */
function dayOf(locale: string, at: number) {
  const year = new Date(at).getFullYear() !== new Date().getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(year ? { year: "numeric" } : {}),
  }).format(at);
}

/** "a, b and c". */
function joinList(items: readonly string[], and: string) {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;
}

/** " (2×2)" after a session name that another session in the same file also has. */
function aside(puzzle: string | undefined) {
  return puzzle ? ` (${puzzle})` : "";
}

/** "rows 4, 17 and 30", at most five numbers and a count of the rest. */
function rowList(
  rows: readonly number[],
  one: string,
  several: string,
  and: string,
  more: (n: number) => string,
) {
  if (rows.length === 1) return `${one} ${rows[0]}`;
  const shown = rows.slice(0, rows.length > 6 ? 5 : rows.length);
  const rest = rows.length - shown.length;
  const tail = rest > 0 ? more(rest) : String(shown.pop());
  return `${several} ${shown.join(", ")} ${and} ${tail}`;
}

export function plural(n: number, one: string, few: string, many: string) {
  const tens = Math.abs(n) % 100;
  const ones = tens % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

const ru: Text = {
  language: "ru",
  events: EVENTS,
  defaultSession: eventInfo("333").label,
  noScramble: "Нет скрамбла",
  pictureEnlarge: "Увеличить картинку скрамбла",
  retry: "Ещё раз",
  sessions: "Сессии",
  newSession: "Новая сессия",
  renameSession: "Переименовать сессию",
  sessionActions: "Действия с сессией",
  deleteSession: "Удалить сессию",
  sessionName: "Название сессии",
  event: "Дисциплина",
  save: "Сохранить",
  cancel: "Отмена",
  comment: "Комментарий",
  commentPrefix: "// ",
  solveNo: (n) => `№ ${n}`,
  repeat: {
    action: "Ещё раз",
    of: (n) => `Снова № ${n}`,
    leave: "К новым скрамблам",
    attempts: "Попытки на этом скрамбле",
    count: (n) => `${n} ${plural(n, "попытка", "попытки", "попыток")}`,
    first: "Это первая попытка",
    last: "Это последняя попытка",
  },
  noSolve: "Сборок ещё нет",
  noEarlier: "Раньше сборок нет",
  noEarlierScramble: "Раньше скрамблов нет",
  previousScramble: "Предыдущий скрамбл",
  solveHistory: "История сборок",
  averageDetail: {
    inspect: "Показать сборки",
    inspectBest: "Показать лучшее среднее",
    loading: "Загрузка сборок…",
    unavailable: "Эти сборки недоступны.",
    previous: "Предыдущие сборки",
    next: "Следующие сборки",
    copy: "Скопировать среднее",
    copied: "Среднее скопировано",
    fallback: "Скопируйте выделенный текст",
  },
  earlierSolve: "Предыдущая сборка",
  laterSolve: "Следующая сборка",
  nextScramble: "Следующий скрамбл",
  scrambleCopied: "Скрамбл скопирован",
  scrambleCopyFailed: "Не удалось скопировать скрамбл",
  noLater: "Это последняя сборка",
  movedTo: (n, name) =>
    n === 1
      ? `Перенесена в «${name}»`
      : `${n} ${plural(n, "сборка перенесена", "сборки перенесены", "сборок перенесено")} в «${name}»`,
  notMoved: {
    missing: "Не перенесено: одной из сборок уже нет.",
    destination: "Не перенесено: этой сессии уже нет.",
    event: "Не перенесено: в этой сессии другая головоломка.",
    changed: "Не перенесено: сборки успели измениться. Попробуйте ещё раз.",
  },
  moveCount: (n) => `Перенести ${n}`,
  splitHere: "Разделить здесь",
  splitName: (name, at) => `${name} по ${dayOf("ru-RU", at)}`,
  splitDone: (n, name) =>
    `${n} ${plural(n, "ранняя сборка", "ранние сборки", "ранних сборок")} теперь в «${name}»`,
  notSplit: {
    missing: "Не разделено: этой сборки уже нет.",
    first: "Раньше сборок нет",
    changed: "Не разделено: сборки успели измениться. Попробуйте ещё раз.",
    gone: "Не разделено.",
  },
  deleteCount: (n) => `Удалить ${n}`,
  clearSelection: "Отмена",
  moreSolves: "Показать ещё",
  penaltyOk: "OK",
  penaltyPlus2: "+2",
  penaltyDnf: "DNF",
  deleteSolve: "Удалить",
  undo: "Отменить",
  stats: "Статистика сессии",
  chooseStat: "Выбрать показатель",
  customAverage: "Своё среднее",
  averageLength: "Число сборок",
  averageLengthError: "Введите целое число от 5",
  resetAverages: "Сбросить средние",
  count: "Сборок",
  best: "мин",
  mean: "ср",
  ao5: "ao5",
  ao12: "ao12",
  mo3: "mo3",
  ao100: "ao100",
  undoSession: "Удаление сессии",
  undoArchive: "Архивация сессии",
  undoOrder: "Порядок сессий",
  undoPenalty: "Смена штрафа",
  undoComment: "Смена комментария",
  undoSolve: "Удаление сборки",
  undoSolves: "Удаление сборок",
  undoMove: "Перенос сборок",
  undoMerge: "Объединение сессий",
  undoSplit: "Разделение сессии",
  timer: "Таймер",
  backToTimer: "Таймер",
  locale: "ru-RU",
  train: {
    title: "Алгоритмы",
    short: "Алги",
    modes: { learn: "Учить", drill: "Отработка", review: "Повтор" },
    all: "Все",
    none: "Ни одного",
    twoLook: "В два этапа",
    puzzles: { "333": "3×3", "222": "2×2" },
    puzzleNames: { "333": "Кубик 3×3", "222": "Кубик 2×2" },
    slots: { fr: "FR", fl: "FL", br: "BR", bl: "BL" },
    slotNames: {
      fr: "Передний правый слот",
      fl: "Передний левый слот",
      br: "Задний правый слот",
      bl: "Задний левый слот",
    },
    add: "В отработку",
    remove: "Убрать из отработки",
    moves: (n: number) => `${n} ${plural(n, "ход", "хода", "ходов")}`,
    picture: "Картинка",
    scramble: "Скрамбл",
    nothing: "Отрабатывать пока нечего. Добавьте случаи в «Учить».",
    drillAll: "Отрабатывать все случаи",
    mine: "Мои",
    everyCase: "Все",
    noWeak:
      "Повторять сейчас нечего. Случай попадает сюда, когда подошёл его срок, когда он медленнее остальных или в пяти попытках дважды с ошибкой.",
    today: ({
      due,
      slow,
      missed,
    }: {
      due: number;
      slow: number;
      missed: number;
    }) =>
      [
        due > 0 && `${due} к повтору`,
        slow > 0 &&
          `${slow} ${plural(slow, "медленный", "медленных", "медленных")}`,
        missed > 0 && `${missed} с ошибками`,
      ]
        .filter(Boolean)
        .join(", "),
    noAlg: "Алгоритма пока нет.",
    more: (n: number) => `Ещё ${n}`,
    use: "Выбрать",
    preparing: "// готовлю скрамбл",
    recognition: "распознавание",
    median: "медиана",
    next: "Дальше",
    missed: "Ошибка",
    afterKeys: "Пробел — дальше · M — ошибка",
    back: "Случаи",
    split: "Отсечка",
    execution: "исполнение",
    splitHint: {
      pictureKey: "Пробел, когда узнали случай, ещё раз — стоп",
      pictureTouch: "Коснитесь, когда узнали случай, ещё раз — стоп",
      scrambleKey: "Зажмите пробел, отпустите; пробел, когда узнали случай",
      scrambleTouch: "Зажмите, отпустите; коснитесь, когда узнали случай",
    },
    keys: [
      ["Space", "Зажать и отпустить: старт"],
      ["Space", "Отсечка: случай узнан"],
      ["Space", "Стоп"],
      ["Space Enter", "Следующий случай"],
      ["KeyM", "Ошибка"],
      ["Escape", "Назад"],
      ["Shift+Slash", "Клавиши"],
    ],
  },
  progress: {
    title: "Прогресс",
    solves: "Сборки",
    since: { 30: "30 д", 365: "1 г", best: "лучшее" },
    single: "сборка",
    days: "дней",
    run: "подряд",
    needs: (n: number) =>
      `Для среднего ${plural(n, "нужна", "нужны", "нужно")} ${n} ${plural(n, "сборка", "сборки", "сборок")}.`,
    none: "Сборок пока нет.",
    solveAt: (solve: string, date: string) => `Сборка ${solve} · ${date}`,
    trend: (average: string, from: string, to: string) =>
      `Тренд ${average}: от ${from} до ${to}`,
    calendar: "Дни со сборками",
    today: "сегодня",
    distribution: "Разброс",
    dnf: "DNF",
    mean: "ср",
    solveCount: (n: number) =>
      `${n.toLocaleString("ru-RU")} ${plural(n, "сборка", "сборки", "сборок")}`,
    dayCount: (n: number) => `${n} ${plural(n, "день", "дня", "дней")}`,
    noSolves: "нет сборок",
    target: {
      title: "Цель",
      input: "Быстрее",
      under: (time: string) => `Быстрее ${time}`,
      about: (date: string) => `примерно ${date}`,
      perDay: (change: string) => `${change} в день`,
      perWeek: (change: string) => `${change} в неделю`,
      perMonth: (change: string) => `${change} в месяц`,
      basis: (days: number, solves: number) =>
        `по ${days} ${plural(days, "дню", "дням", "дням")}, ${solves.toLocaleString("ru-RU")} ${plural(solves, "сборке", "сборкам", "сборкам")}`,
      reasons: {
        already: "уже быстрее",
        sparse: "нужно 7 дней по 5 сборок за 90 дней",
        flat: "без изменений",
        stale: "30 дней без тренировок",
        rising: "в последнее время медленнее",
        distant: "больше чем через год",
      },
    },
    loading: "Загрузка прогресса…",
    failed: "Не удалось загрузить прогресс.",
    scope: {
      options: "Что считать",
      scope: "Сборки",
      session: "Одна сессия",
      folder: "Папка",
      selection: "Выбранные сессии",
      puzzle: "Головоломка",
      average: "Среднее",
      auto: "Автоматически",
      count: (n: number) =>
        `${n.toLocaleString("ru-RU")} ${plural(n, "сборка", "сборки", "сборок")}`,
    },
  },
  updateReady: "Готова новая версия.",
  updateAction: "Обновить",
  updateFailed: "Обновление не установилось. Эта версия работает дальше.",
  dbMemory: "Сборки хранятся, только пока открыта эта вкладка.",
  dbEarlier:
    "Сборки из прежней версии хранятся отдельно. Добавить их можно в Настройках › Данные.",
  unsaved: (n: number) =>
    `${n} ${plural(n, "сборка", "сборки", "сборок")} пока нигде не ${plural(n, "сохранена", "сохранены", "сохранены")}: браузер отказался ${plural(n, "её", "их", "их")} записать.`,
  unsavedDownload: "Скачать",
  dbBusy:
    "Открыто в другой вкладке. Сборки отсюда сохранятся, когда та вкладка закроется.",
  dbFailed:
    "Не удалось открыть или записать базу. Сборки отсюда ждут в браузере и сохранятся, когда база откроется.",
  inspection: "Инспекция",
  calls: { 8: "8 секунд", 12: "12 секунд" },
  formats: {
    ao5: "Среднее из 5",
    mo3: "Среднее из 3",
    bo1: "Лучшая из 1",
    bo2: "Лучшая из 2",
    bo3: "Лучшая из 3",
    bo5: "Лучшая из 5",
  },
  scramble: "Скрамбл",
  attempt: "Попытка",
  penalty: "Штраф",
  empty: "Сборок пока нет",
  emptyHintKey: "Зажмите пробел и отпустите",
  leftHand: "Левый Ctrl",
  rightHand: "Правый Ctrl",
  emptyHintTouch: "Зажмите экран и отпустите",
  emptyImport: "Сборки из другого таймера:",
  emptyHintKeys: (keys: string) => `Зажмите ${keys} и отпустите`,
  emptyHintHands: "Зажмите обе клавиши и отпустите",
  drill: {
    title: "Тренировочные скрамблы",
    kind: {
      official: "Обычные 3×3",
      "easy-cross": "Крест за несколько ходов",
      "easy-xcross": "Икс-крест за несколько ходов",
      "cross-solved": "Крест собран",
      "edges-only": "Только рёбра",
      "corners-only": "Только углы",
      "two-gen": "Только R и U",
      oll: "Случаи OLL",
      pll: "Случаи PLL",
      coll: "Случаи COLL",
      ll: "Случаи последнего слоя",
    },
    turns: "Ходов",
    cross: "Крест",
    colour: {
      U: "белый",
      D: "жёлтый",
      F: "зелёный",
      B: "синий",
      R: "красный",
      L: "оранжевый",
    },
    crossIn: (n: number, colour: string) =>
      `${colour} крест, ${n} ${plural(n, "ход", "хода", "ходов")}`,
    xcrossIn: (n: number, colour: string) =>
      `${colour} икс-крест, ${n} ${plural(n, "ход", "хода", "ходов")}`,
    crossSolvedOn: (colour: string) => `${colour} крест собран`,
    edgesOnly: "только рёбра",
    cornersOnly: "только углы",
    twoGen: "только R и U",
    cases: (set: string, n: number) =>
      n === 0
        ? `${set}: случаи не выбраны`
        : `${set}, ${n} ${plural(n, "случай", "случая", "случаев")}`,
    line: "Отработка",
    change: "Изменить",
    find: "Найти случай",
    all: "Все",
    none: "Ни одного",
    pickOne: "Выберите хотя бы один случай.",
    group: { cross: "Крест", dot: "Точка", line: "Линия", L: "Уголок" },
    solution: "Решение",
    hide: "Скрыть",
    searching: "ищу",
    notFound: "нет за 14 ходов",
    failed: "Не найдено.",
    retry: "Ещё раз",
    slotOf: (slot: string) => `слот ${slot}`,
    solved: "уже собран",
    open: "Тренировочные скрамблы",
    showSolution: "Показать решение креста",
    setting: "Скрамблы",
    official: "Обычные",
  },
  waiting: (event: string) => `// готовлю скрамбл: ${event}`,
  toGo: (n: number) => `ещё ${n}`,
  themeEditor: {
    title: "Своя тема",
    base: "Основа",
    token: {
      ground: "Фон",
      ink: "Текст",
      dim: "Второстепенный текст",
      gutter: "Приглушённый текст",
      line: "Подсветка",
      prime: "Ходы со штрихом",
      double: "Двойные ходы",
      wide: "Широкие ходы",
      warn: "+2 и предупреждения",
      error: "DNF и ошибки",
      pb: "Рекорды",
    },
    picture: "Фоновая картинка",
    choose: "Выбрать",
    remove: "Убрать",
    strength: "Заметность картинки",
    file: "Файл темы",
    export: "Экспорт",
    import: "Импорт",
    resetColours: "Сбросить цвета",
    unreadable: (list: string) =>
      `Плохо читается: ${list}. Остаются прежние читаемые цвета.`,
    pictureRefused:
      "Выберите картинку PNG, JPEG или WebP до 2 МБ и 4096 пикселей.",
    importRefused: "Это не тема cubehaus.",
    saveFailed: "Не удалось сохранить тему.",
  },
  sizes: {
    title: "Размеры",
    part: {
      scramble: "Скрамбл",
      picture: "Картинка",
      time: "Время",
      averages: "Средние",
      times: "Времена",
    },
    note: (part: string, percent: number) => `${part} ${percent} %`,
    where: "Наведите указатель на то, что изменить",
    reset: "Сбросить размеры",
    resetDone: "Размеры сброшены",
  },
  inspectionOn: "Инспекция включена",
  inspectionOff: "Инспекция выключена",
  inspectionCancelled: "Инспекция отменена",
  tooShort: "Меньше 0,06 с: не сборка. Ещё раз",
  plus2Sum: (raw: string, added: number, result: string) =>
    `Штриховка: ${raw} + ${added} = ${result}`,
  inspectionPenalty: (penalty: "+2" | "DNF", seconds: string) =>
    `${penalty}: инспекция длилась ${seconds} с`,
  handPlus2: "+2 поставлен вручную",
  dnfAt: (raw: string) => `DNF. Остановлено на ${raw}`,
  entry: {
    mode: "Ввод результата",
    typing: "Ввод вручную",
    solution: "Решение",
    time: "Время",
    attempted: "В попытке",
    solved: "Собрано",
    scrambles: "Показать скрамблы",
    check: "Проверить решение",
    startClock: "Запустить отсчёт",
    invalidTime:
      "Введите положительное время в верном формате, например 12.34.",
    invalidCount: "Введите целое число от нуля до числа кубиков в попытке.",
    invalidAttempted: "Введите число кубиков, не меньше двух.",
    invalidMove: (move: string) => `Недопустимый ход: ${move}`,
    unsolved: "Решение не собирает кубик",
    checkFailed: "Не удалось проверить решение. Попробуйте ещё раз.",
  },
  fmcHint: "Введите число ходов, Enter. D: DNF",
  fmcOver: "Больше 80 ходов: DNF",
  mbfHint: (cubes: number) =>
    `Сколько из ${cubes} кубиков собрано? Enter. Esc удаляет попытку`,
  mbfPoints: (points: number) =>
    `${points} ${plural(points, "очко", "очка", "очков")}`,
  mbfDnf: "DNF: собрано меньше 2 или несобранных больше, чем собранных",
  notYet: (title: string) => `${title}: пока нет`,
  paletteTitle: "Команды",
  palettePlaceholder: "Введите команду",
  keysTitle: "Клавиши",
  switcher: {
    query: "Найти или создать",
    create: (name) => `Создать «${name}»`,
    rename: "Переименовать",
    delete: "Удалить",
    event: (label) => `Дисциплина: ${label}. Следующая`,
    folder: "Папка",
    newFolder: "Новая папка",
    moveOut: "Из папки",
    folderActions: "Действия с папкой",
    moved: "Порядок изменён.",
    undo: "Отменить",
    archive: "В архив",
    unarchive: "Вернуть из архива",
    archived: "В архиве.",
    unarchived: "Снова в списке.",
    archivedMark: "в архиве",
    trashed: "В корзине 30 дней.",
    archiveView: "Архив",
    trashView: "Корзина",
    back: "Назад к сессиям",
    restored: (name) => `Восстановлено: ${name}`,
    trashEmpty: "Корзина пуста.",
    trashNote:
      "Удалённые сессии и сборки лежат здесь 30 дней. Выберите, чтобы вернуть.",
    solves: (n) => `${n} ${plural(n, "сборка", "сборки", "сборок")}`,
    left: (span) => `ещё ${span}`,
    restore: (name, left) => `Восстановить: ${name}. ${left}`,
    moveTitle: "Перенос сборок",
    moveQuery: (n) =>
      n === 1
        ? "Перенести сборку в…"
        : `Перенести ${n} ${plural(n, "сборку", "сборки", "сборок")} в…`,
    moveNone: (event) =>
      `Другой сессии ${event} пока нет. Введите название, чтобы создать.`,
    merge: "Объединить",
    mergeTitle: "Объединить сессии",
    mergeQuery: (names) =>
      names.length === 1
        ? `Влить «${names[0]}» в…`
        : `Влить ${names.length} ${plural(names.length, "сессию", "сессии", "сессий")} в…`,
    mergePicked: (n) => (n === 1 ? "Влить в…" : `Влить ${n} в…`),
    mergeNone: (event) => `Другой сессии ${event}, куда влить, нет.`,
    merged: (name) => `Влито в сессию «${name}».`,
    notMerged: {
      missing: "Не объединено: одной из сессий уже нет.",
      target: "Не объединено: этой сессии уже нет.",
      event: "Объединяются только сессии одной головоломки.",
      changed: "Не объединено: сессии изменились. Попробуйте ещё раз.",
      gone: "Не объединено.",
      nothing: "Не объединено.",
    },
  },
  settings: {
    data: "Данные",
    backup: "Все данные одним файлом",
    backupSave: "Сохранить",
    backupFailed: "Не удалось сохранить файл.",
    restore: "Восстановить из файла",
    restoreChoose: "Выбрать",
    restoring: "Восстановление…",
    restored: (r) =>
      `Восстановлено: добавлено ${r.inserted}, обновлено ${r.updated}, уже было ${r.unchanged}.`,
    restoreProblem: {
      format: "Это не файл копии cubehaus. Ничего не изменено.",
      newer:
        "Копия сделана в более новой версии cubehaus. Обновите приложение и восстановите её.",
      reference:
        "Файл копии повреждён: у части сборок в нём нет сессий. Ничего не изменено.",
    },
    restoreFailed: "Восстановить не удалось. Ничего не изменено.",
    earlier: "Сборки из прежней версии",
    earlierAdd: "Добавить",
    earlierAdded:
      "Добавлено. Где строка была в обоих местах, осталась более новая правка.",
    earlierFailed: "Их не удалось прочитать. Ничего не изменено.",
    backups: "Копии",
    backupFolder: "Папка",
    backupFolderChange: "Изменить",
    backupFolderFailed: "Эту папку не удалось использовать.",
    backupLast: "Последняя копия",
    backupNone: "Пока нет",
    backupNow: "Сделать сейчас",
    backupRetry: "Ещё раз",
    backupDone: "Копия сделана.",
    backupError: (reason) => `Последняя копия не удалась: ${reason}`,
    backupRestore: "Восстановить",
    backupConfirm: (when) =>
      `Заменить историю копией от ${when}? Текущая история сначала будет скопирована.`,
    backupCancel: "Отмена",
    importFrom: "Сборки из другого таймера",
    importOneKind: "Выберите один файл или CSV-файлы CubeTime.",
    importCsvPenalties:
      "В CSV из CubeTime нет +2 и DNF. Экспорт CubeTime для csTimer их сохраняет.",
    importCsvZone: (zone) => `Время без пояса читается как ${zone}.`,
    importCsvRows: (name, rows, code, puzzle) =>
      `«${name}»${aside(puzzle)}: ${rowList(rows, "строка", "строки", "и", (n) => `ещё ${n}`)} не ${rows.length === 1 ? "войдёт" : "войдут"}. ${
        {
          "invalid-time": "Время не читается.",
          "invalid-date": "Дата не читается.",
          "ambiguous-local-date":
            "Этот час был дважды, когда переводили часы назад.",
          "nonexistent-local-date":
            "Этого часа не было, когда переводили часы вперёд.",
          "missing-dnf-time": "У DNF в CSV нет времени.",
          "ambiguous-plus2": "В CSV +2 не отделить от времени.",
        }[code]
      }`,
    importChoose: "Выбрать",
    importReading: "Чтение файла…",
    importing: "Импорт…",
    importFailed: "Импорт не завершился. Ничего не изменено.",
    importProblem: {
      json: "Файл не читается. Выберите файл, который выгружает csTimer.",
      object: "В этом файле нет сессий csTimer.",
      sessions: "В этом файле нет сессий csTimer.",
      "cubetime-csv":
        "Не удалось прочитать CSV из CubeTime. Проверьте заголовок и кавычки.",
      "cubetime-selection":
        "Выберите CSV-файлы с разными именами и укажите название каждой сессии.",
      "twisty-backup":
        "Резервная копия Twisty Timer не читается. Ничего не импортировано.",
      cubedesk: "Экспорт CubeDesk не читается. Ничего не импортировано.",
      "unsupported-shape":
        "Этот файл не читается. cubehaus читает экспорт csTimer, CSV-файлы CubeTime, резервные копии Twisty Timer и экспорт CubeDesk.",
    },
    importSessions: "Сессии в файле",
    importConfirm: (n, penalized = 0) =>
      n > 0
        ? `Импортировать ${n} ${plural(n, "сборку", "сборки", "сборок")}`
        : penalized > 0
          ? `Добавить ${penalized} ${plural(penalized, "штраф", "штрафа", "штрафов")}`
          : "Импортировать сессии",
    importCancel: "Отмена",
    importClose: "Закрыть",
    importHere: (n) => `Из них ${n} уже здесь.`,
    importAllHere: (n) =>
      n === 1
        ? "Эта сборка уже здесь."
        : `Все ${n} ${plural(n, "сборка", "сборки", "сборок")} уже здесь.`,
    importPenalized: (n) =>
      `${n} из них ${plural(n, "получит", "получат", "получат")} +2 или DNF, которых не было в CSV.`,
    exportCsTimer: "Сборки для csTimer",
    exportCsv: "Сборки таблицей",
    exported: (r) =>
      r.solves === 0
        ? "Сохранено."
        : `Сохранено. У ${r.solves} ${plural(r.solves, "сборки", "сборок", "сборок")} в файл не вошли ${joinList(
            lost(r.fields, {
              started_at: "миллисекунды даты",
              inspection_ms: "время осмотра",
              moves: "число ходов",
              solution: "решения",
              cubes_solved: "число кубиков",
              cubes_attempted: "число кубиков",
              import_extra: "сплиты",
            }),
            "и",
          )}. «Все данные одним файлом» сохраняет всё.`,
    importUnknownEvent: (name, type, from) =>
      type
        ? `«${name}» станет сессией 3×3: в cubehaus нет головоломки для «${type}» из ${from}.`
        : `У «${name}» не указана головоломка, она станет сессией 3×3.`,
    importMissingSession: (name, puzzle) =>
      `«${name}»${aside(puzzle)} нет среди сессий файла: её сборки войдут под этим названием.`,
    importUnreadRows: (name, rows, puzzle) =>
      `«${name}»${aside(puzzle)}: ${rowList(rows, "строка", "строки", "и", (n) => `ещё ${n}`)} не ${rows.length === 1 ? "читается и не войдёт" : "читаются и не войдут"}.`,
    imported: (r) => {
      const penalized = r.penalized ?? 0;
      const result =
        r.added > 0
          ? `${plural(r.added, "Добавлена", "Добавлены", "Добавлено")} ${r.added} ${plural(r.added, "сборка", "сборки", "сборок")}.${r.skipped > 0 ? ` Ещё ${r.skipped} уже ${plural(r.skipped, "была", "были", "было")} здесь.` : ""}`
          : r.skipped > 0 && penalized === 0
            ? `Ничего нового: ${r.skipped} ${plural(r.skipped, "сборка", "сборки", "сборок")} уже ${plural(r.skipped, "была", "были", "было")} здесь.`
            : r.created > 0
              ? `${plural(r.created, "Добавлена", "Добавлены", "Добавлено")} ${r.created} ${plural(r.created, "сессия", "сессии", "сессий")} без сборок.`
              : penalized === 0
                ? "Ничего нового."
                : "";
      if (penalized === 0) return result;
      const penalties = `${plural(penalized, "Добавлен", "Добавлено", "Добавлено")} ${penalized} ${plural(penalized, "штраф", "штрафа", "штрафов")}.`;
      return result ? `${result} ${penalties}` : penalties;
    },
    theme: "Тема",
    themeChoices: {
      system: "Системная",
      dark: "Тёмная",
      light: "Светлая",
      custom: "Своя",
    },
    title: "Настройки",
    language: "Язык",
    languages: { en: "English", ru: "Русский" },
    inspection: "Инспекция в этой сессии",
    inspectionChoices: {
      official: "15 секунд, как на соревнованиях",
      off: "Выключена",
    },
    calls: "Сигналы на 8 и 12 секундах",
    callChoices: { tick: "Щелчок", voice: "Голос", off: "Выключены" },
    keysTitle: "Горячие клавиши",
    keysChange: "Изменить",
    keysRemove: "Убрать",
    keysReset: "Сбросить",
    keysAll: "Все клавиши",
    keysOpen: "Открыть",
    keysDone: "Готово",
    keysPress: "Нажмите клавишу",
    keysCancel: "Запись отменена",
    keysUnbound: "Не назначено",
    keysReserved: "Занято системой или браузером",
    keysInvalid: "Выберите другую клавишу",
    keysFailed: "Не удалось сохранить клавиши",
    keysConflict: (binding: string, names: string) =>
      `${binding} уже используется: ${names}`,
    startMode: "Клавиши старта",
    startSpace: "Пробел",
    startTwoHand: "Две руки",
    holdMs: "Удержание перед стартом",
    holdValue: (ms: number) => `${(ms / 1000).toFixed(2).replace(".", ",")} с`,
    running: "Время во время сборки",
    runningChoices: {
      tenths: "Десятые",
      hundredths: "Сотые",
      seconds: "Секунды",
      hidden: "Скрыто",
    },
    precision: "Знаков после запятой",
    holdingTop: "Цвет сверху",
    holdingFront: "Цвет спереди",
    layout: "Вид таймера",
    layouts: { lift: "Журнал", times: "Времена", focus: "Фокус" },
    recordCue: "Выделять рекорды",
    recordCueChoices: { on: "Вкл.", off: "Выкл." },
    today: "Сборки за сегодня",
    awake: "Не гасить экран",
    entry: "Ввод результата в этой сессии",
  },
  officialFrom: (date: string) => `официальна с ${date}`,
  officialUntil: (date: string) => `официальна до ${date}`,
};

export const texts: Record<"en" | "ru", Text> = { en, ru };

export function textFor(language: "en" | "ru"): Text {
  return texts[language];
}

export function eventName(
  event: { name: string; nameRu: string },
  language: "en" | "ru",
): string {
  return language === "ru" ? event.nameRu : event.name;
}

// The English table, for code that does not know the language yet.
export const text: Text = en;
