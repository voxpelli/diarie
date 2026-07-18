# Changelog

## [0.2.0](https://github.com/voxpelli/diarie/compare/v0.1.0...v0.2.0) (2026-07-18)


### 🌟 Features

* **brand:** note human-directed, AI-built in the diarie.dev footer ([01f0911](https://github.com/voxpelli/diarie/commit/01f09112cd0bb273bcd9e2370d5ef2e683b8c1be))


### 🩹 Fixes

* **diarie:** pages deploy installs without a lockfile (npm install, not npm ci) ([aa4c4a8](https://github.com/voxpelli/diarie/commit/aa4c4a8ecefdfab32bdaa4623c6b9d69df296fa4))


### 📚 Documentation

* **diarie:** add README badges, including a human-directed/AI-built badge ([dd65701](https://github.com/voxpelli/diarie/commit/dd65701a13923ae34eaeda86a4acc2b0ea5fb78b))
* **diarie:** correct the loadTasks example in the README ([55fafad](https://github.com/voxpelli/diarie/commit/55fafad55635aa5842fab2fe0921fa4ad26048b7))


### 🧹 Chores

* **diarie:** backlog AI Usage Scale adoption (diarie-aus), deferred ([f5eb7e4](https://github.com/voxpelli/diarie/commit/f5eb7e43cb62552817722eb2cd4e7c02711482bf))
* **diarie:** record post-publish CI findings in the store ([789d3b0](https://github.com/voxpelli/diarie/commit/789d3b0c7b38066657d93c31a4b436383c594408))

## 0.1.0 (2026-07-19)


### 🌟 Features

* first public release — a flat-YAML task tracker that is *just files*: no daemon, no database, no git hooks
* `diarie init` / `ready` / `stats` / `validate` / `migrate`, reading a `.diarie/tasks/tasks-<slug>.yml` store you edit directly — there is no CRUD command, on purpose
* a missing store is an error (`ENOSTORE`), never an empty backlog — a machine-readable exit-code taxonomy (`0` the answer, `1` `InputError`, `2` `ResultError`) so a broken tracker cannot report a clean sprint
* library-with-a-bin: importable `computeReady` / `loadTasks` plus a typed `diarie/schema` subpath
