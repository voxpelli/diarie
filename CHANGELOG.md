# Changelog

## 0.1.0 (2026-07-19)


### 🌟 Features

* first public release — a flat-YAML task tracker that is *just files*: no daemon, no database, no git hooks
* `diarie init` / `ready` / `stats` / `validate` / `migrate`, reading a `.diarie/tasks/tasks-<slug>.yml` store you edit directly — there is no CRUD command, on purpose
* a missing store is an error (`ENOSTORE`), never an empty backlog — a machine-readable exit-code taxonomy (`0` the answer, `1` `InputError`, `2` `ResultError`) so a broken tracker cannot report a clean sprint
* library-with-a-bin: importable `computeReady` / `loadTasks` plus a typed `diarie/schema` subpath
