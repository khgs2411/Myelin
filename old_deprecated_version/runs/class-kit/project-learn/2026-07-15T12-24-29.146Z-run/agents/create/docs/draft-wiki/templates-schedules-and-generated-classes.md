# Templates, schedules, and generated classes

Templates are reusable defaults, not registerable classes and not a live source of truth for ordinary existing classes. A concrete class may be standalone, manually seeded from a template, or generated from a schedule. Generated classes preserve schedule/template provenance and can be protected from later automation.

Schedules require a template. Their recurrence values are `one_time` and `weekly`; weekly requires one or more weekdays (`0` Sunday through `6` Saturday), while one-time requires `weekdays: []`, uses `startsOn`, and has no `endsOn`. Status values described by the SDK are `active`, draft, paused, and archived: create/update generation runs only when the resulting schedule is `active`; the other states return no generation until a supported activation or explicit generation path. Operational commands are preview, generate, pause, archive, skip date, and unskip date.

Precedence is: schedule template/provenance constraints before recurrence validation; resulting schedule state before automatic generation; generated-class protection before subsequent schedule automation overwrites fields. Users register for generated concrete classes, never schedules or templates.

Evidence: `target-repo/docs/api/class-api-map.md`, `target-repo/docs/sdk/client-sdk.md`, `target-repo/docs/shared/context.md`. Missing: implementation and regression coverage for schedule state values, activation behavior, protected-field refresh rules, skip semantics, and generated-class collision handling.

