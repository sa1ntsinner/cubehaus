# CubeTime CSV fixture

`cubetime.csv` is synthetic. It exercises the four measured columns and uses the ISO
UTC spelling from Task 06. The two timed records are intentionally equal. Companion
unit cases cover the measured space-separated date and numeric offset spelling,
shortest-round-trip decimal seconds, and a header-only session.

Observed: `Time,Comment,Scramble,Date` in a CubeTime export of an
unrecorded version. `Time` is decimal seconds and the importer truncates them to
milliseconds. `Comment` and `Scramble` are text. `Date` carries the instant when the
file supplies an offset. CubeTime CSV had no penalty column. The csTimer-compatible
JSON route carries penalties. The fixture makes no claim about native archives or
other CubeTime versions.
