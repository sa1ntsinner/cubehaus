# Twisty Timer backup fixture

`twisty-backup.txt` contains two identical fictional attempts. The published app
was not used to generate these bytes.

- The backup has the literal comma-separated header shown in the fixture. Solve
  records have seven double-quoted, semicolon-separated cells in header order.
  The time and Unix date are in milliseconds. The example shows puzzle code
  `333`, a user category, and penalty code `0` on ordinary solves. The same
  report distinguishes the app's separate “export to other timers” option.
  [Public backup format report](https://github.com/cs0x7f/cstimer/issues/66)
- The `.txt` backup filename and conversion of an exported epoch millisecond
  date to a UTC date are documented in the worked example.
  [scramble-history README](https://pypi.org/project/scramble-history/0.1.15/#twistytimer-cubers-io)
- A user documents the backup puzzle codes `222` through `777`, `mega`,
  `pyra`, and `sq1`, and reports that categories can be user-defined.
  [User's Twisty Timer backup format notes](https://gist.github.com/euphwes/543394d5e73f95fd5b9ff214d46ae5c9)
- The app listing describes categories, comments, penalties, and solve backups.
  [Google Play listing](https://play.google.com/store/apps/details?id=com.aricneto.twistytimer)

## Parser decisions

- The permitted descriptions did not establish penalized time semantics or the
  codes for +2 and DNF. This fixture uses the Task 07 interpretation that
  `Time(millis)` holds the raw integer duration, `1` means +2, and `2` means
  DNF. The parser stores the supplied duration verbatim and leaves the +2
  adjustment to the normal effective-time calculation. It rejects missing raw
  time, decorated values, unsupported codes and arithmetic overflow. A numeric
  time from a producer that silently includes +2 is indistinguishable from a
  raw numeric time with the same bytes.
- The accepted date shape is a 13-digit Unix millisecond timestamp, as in the
  public examples. Missing dates and apparent epoch seconds are rejected.
- `clock` and `skewb` are accepted as literal puzzle codes matching the events
  of those names. Their backup spellings were not independently verified.
  Unknown puzzle codes are rejected. The category is kept literally, so a
  category label such as `OH` never overrides the puzzle.
- The parser reuses the shared delimited reader, including BOM, LF/CRLF, quoted
  line breaks and doubled quotes. The complete decoded cells are retained with
  each solve and the original puzzle/category pair with the session binding.
- External/share shapes are rejected by the picker. A missing per-solve date
  cannot be reconstructed from a puzzle or category selection.
