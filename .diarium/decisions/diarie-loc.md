---
id: diarie-loc
title: Can the store be renamed or relocated? — no; one name, a closed pair of forms, no knob
status: pending
type: decision
priority: medium
updated: '2026-07-28'
---

## Decision

**Decided 2026-07-28:** each major version of diarie has exactly one canonical store _name_ —
`diarium`, at the project root, in one of exactly two forms: `diarium/` or `.diarium/` (the posture
choice, decided in [diarie-pos](./diarie-pos.md)). There is no configuration to rename or relocate
it: no config key, no environment variable, no flag. The posture is not a knob in the sense this
record refuses — it is expressed by which directory exists on disk, drawn from a closed pair, with
nothing to read before the store can be found. `--root` remains, and is a different thing: it
resolves _where the project is_ (a nested cwd, a monorepo subpath); it does not rename the register
inside it.

This records shipped philosophy as deliberate: `init.js` already states "There is no `.diarierc`,
no config, no state file. If this command ever grows a template engine, something has gone wrong
with the substrate."

## Rationale

* **A knob turns `ENOSTORE` into mush.** "no `diarium/` (dotted or not) found" is a checkable
  sentence with a bounded search space. "no store at any configured location" requires reading
  configuration before the error means anything — and the configuration is itself a second thing
  to find first.
* **Every reader pays for a variable, forever.** Docs, agent instructions, scripts, and
  integrations must otherwise carry "such as `diarium/`, or a configured path" on every mention.
  The tax is small per read and paid on every read. The pair pays a bounded version — one "dotted
  or not" clause — weighed and accepted in [diarie-pos](./diarie-pos.md); an open set pays an
  unbounded one, and stays refused.
* **The register is findable because everyone knows where it is.** A diarium works because its
  location is not negotiated per visit. Constancy is the feature, not a limitation awaiting a
  workaround.

## Prior art, both directions

* **Fixed names dominate the manifest world.** `Cargo.toml`, `package.json`, `pyproject.toml`,
  `go.mod` — none lets the file be renamed. Cargo's `--manifest-path` moves _where to look_, never
  _what it is called_: the exact split this record makes with `--root`.
* **`deno.json`/`.jsonc` is the pair's honest price tag.** A two-name set puts an "or" into every
  sentence that names the file. First cited here as a warning; the posture decision then chose to
  pay that exact tax, knowingly, for a variance judged real — and fenced it at two. The warning
  stands for any third form.
* **git itself has the knob, and is the honest counterexample.** `GIT_DIR`, `GIT_WORK_TREE`,
  `core.worktree` exist; the documentation frames them as scripting mechanisms, and their footgun
  reputation follows from the property this record refuses — with an environment override, two
  shells can disagree about where a repo's own data lives. The stricter lineage — Cargo, npm, Go —
  is the one chosen; the posture pair does not breach it, since disk presence travels with the
  clone in a way an environment never does.
* **Backlog.md ships the open knob.** Its store may be `backlog/`, `.backlog/`, or a path set in
  `backlog.config.yml` — "any other relative path within your project," per its release note. No
  thread documenting user confusion was found, so the claim stays modest: the open knob's visible
  cost is the unbounded disjunction its README now carries, and the support surface that follows.
  The contrast with the closed pair is the point: two forms of one name is a clause;
  any-relative-path is a list without an end.

## Alternatives Considered

* **A config key** (`diarie.config.yml` or similar) — see rationale; also a bootstrapping loop:
  the config that names the store is one more location to resolve before the store can be found.
* **An environment variable** — worse: invisible in the repo, so two clones of the same project
  could disagree about where its own backlog is. `GIT_DIR` demonstrates both the mechanism and its
  reputation.

## Affects

* Nothing ships for this record alone — it fences what [diarie-pos](./diarie-pos.md) implements.
  The posture decision carries the weight this record assigns it: with no location opt-out, name
  and pair are the only choices anyone gets, so both were decided deliberately and separately.
* Multi-store layouts inside one project remain inexpressible, except by pointing `--root` at
  subdirectories that are themselves projects.

## Revival triggers

* A concrete, named layout that `--root` cannot express — for example, two peer stores with
  distinct lifecycles under one project root. Preference for a different folder name or a third
  form does not reopen this; those belong to [diarie-pos](./diarie-pos.md).
* A scripting or embedding need of the `GIT_DIR` kind — an override for plumbing, not people —
  would be weighed as its own narrow decision, not a reopening of this one.

## Revisions

* 2026-07-28 — filed, with one reconciliation the Decision's "no environment variable" needs
  spelling out: the reader ships **`DIARIUM_ROOT`** (renamed from `TASKS_ROOT` in the same change),
  and it is not the knob this record refuses. It is the environment form of `--root` — it names the
  _project root_, exactly as [diarie-spa](./diarie-spa.md) reasoned when it rejected `DIARIE_DIR`
  for misnaming the referent. What stays refused is any variable that changes the register's _name_
  or _place inside the project_. The `GIT_DIR` objection in Alternatives is aimed at that, and is
  unaffected: two clones can disagree about which project root you point a command at, and always
  could — they cannot disagree about what the register is called once found.
* 2026-07-28 — re-cut against the repo: frontmatter and id matched to store conventions
  (`diarie-loc`, provisional mint); the shipped-philosophy confirmation from `init.js` added;
  `ENOSTORE` phrasing aligned with the shipped two-variant error.
* 2026-07-28 — boundary clarified with the posture pair: one canonical _name_, exactly two forms,
  expressed on disk; the deno citation reconciled from pure warning to priced-and-fenced cost. The
  refusal of config keys, environment variables, and arbitrary paths is unchanged — this record
  has now survived a value change (`backlog/` → `.diarie/` → the `diarium` pair) with its
  substance intact, which is what it was written to do.
* 2026-07-28 — after source verification: fixed-name prior art added; git's escape hatches named
  and preempted; Backlog.md framing softened to the observable documentation tax.
