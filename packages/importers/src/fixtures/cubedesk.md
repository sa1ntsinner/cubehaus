# CubeDesk JSON export

`cubedesk.json` contains invented sessions and solves. The published sample was used
only to establish the file format.

## Format evidence

- CubeDesk documents a combined export of solves and sessions under Settings → Data →
  Export data. It also describes solve notes, scrambles, dates, +2 and DNF in its
  csTimer migration guide. [CubeDesk migration and backup guide][guide]
- A publicly posted July 2025 export shows a top-level JSON object with `sessions`
  and `solves` arrays. Session entries have string `id` and `name`, with
  `created_at` and `order` also present. Solve entries have string `id` and
  `session_id` referring to the session's `id`. [Published export example][sample]
- The example has string `cube_type` (observed value `222`), string `scramble`,
  boolean `plus_two` and `dnf`, and numeric `time`, `raw_time`, `started_at`
  and `ended_at`. For the clean solves shown, `time` equals `raw_time`. The
  difference between `ended_at` and `started_at` matches the solve duration
  when those stamps are read as epoch milliseconds and the duration as seconds.
  [Published export example][sample]

## Import decisions and limits

- The observed start stamps are 13-digit integers. The importer accepts that
  representation and skips contradictory start stamps, including seconds-shaped
  numbers. It keeps milliseconds as supplied.
- The public example has only clean solves. For penalized solves, the importer
  treats `raw_time` as the measured seconds before +2 and uses `plus_two` and
  `dnf` as independent flags. A supplied numeric `time` must agree at whole
  millisecond precision with the raw duration plus the indicated +2. `time` may
  be absent, or null for DNF. Rows with missing raw time or contradictory values
  stay out. The importer uses the shortest decimal string of the JSON number and
  truncates it to whole milliseconds.
- CubeDesk documents notes as a feature. The export key `notes` and its optional
  string or null value are assumptions from the task contract. The public example
  does not pin a nonempty note. [CubeDesk migration and backup guide][guide]
- The sample pins the `222` puzzle spelling. The importer recognizes cubehaus's
  timed event codes and reports other nonempty codes when it places them in 3×3.
  An empty source session is imported as 3×3. A referenced missing session gets a
  group named by its ID, split by event if needed, with an issue in the preview.
  Rows with no usable session ID are reported by their position in the solve array.
- The synthetic fixture covers the +2 assumption and the unit tests cover combined
  DNF/+2 and contradictory rows. A fresh export containing penalties and notes from
  the published app was unavailable for this verification.

[guide]: https://www.cubedesk.io/guides/migrate-from-cstimer
[sample]: https://www.scribd.com/document/973962834/cubedesk-data-7-10-2025-9-12-06-PM
