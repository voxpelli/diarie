---
id: diarie-reg
title: Does diarie get a write verb? — yes, `diarie register`, bounded at register-vs-revise
status: pending
type: decision
priority: high
updated: '2026-07-20'
---

## Decision

**Decided 2026-07-20: yes — build `diarie register`,** a create-only verb that allocates a
branch-safe *diarienummer* and persists the initial record, and does nothing after. It is
**possible, not required**: the store stays fully hand-writable (plain Edit on the YAML), and no
read or `validate` ever depends on a row having gone through `register`. It is one door in, not a
gate — which is also why it does not make diarie the owner of your data: you can always bypass it.

The line it must never cross is **register (create) vs revise (edit).** Issuing a diarienummer and
filing the initial record is the registrar's act; changing a filed case's `status`, owner, title, or
deps is casework, and stays in your editor. So there is still no `diarie close`, no `diarie assign`,
and no field-mutation verb of any kind.

## Rationale

Three arguments, each of which survived an adversarial round that had refuted the weaker framings
(an emit-only `stamp`, and a generic "create" verb justified by id *collision-checking*):

1. **Registration is diarie's namesake act, and register-vs-revise is a principled, self-enforcing
   boundary.** "diarie" is a diarium; *diarieföring* — entering an incoming case and stamping its
   *diarienummer* — is the one write the tracker exists to perform. Unlike the vague "create vs
   revise", "register vs revise" answers "why not `close`?" on its own terms: `close` revises a
   registered case, it does not register one. The boundary is anchored in what the product *is*.

2. **A diarienummer is only a diarienummer once it is in the register.** Allocation and persistence
   are inseparable — an id emitted to stdout but not written is a wish, not a number. This is why
   the earlier "emit, write nothing" framing was the wrong shape: it withholds the very act
   (`persist`) that makes the number real. `register` mints *and* writes atomically, the way
   `git commit` mints a SHA and writes the commit in one act.

3. **A good diarienummer is hard to allocate by hand — for humans as much as agents.** It must be
   short, consistent with the id convention, and **collision-resistant across git branches without
   central coordination**. Auto-increment — the obvious short-and-consistent scheme — is banned
   precisely because sequential ids collide when two branches each allocate and then merge. Getting
   "short + consistent + merge-safe" right by hand is genuine ceremony, so it belongs in a primitive,
   not a recipe. That it serves humans too dispels the "an affordance only agents need is evidence
   the store shape is wrong" objection.

Arguments 1 and 3 are the same act seen twice: assigning a merge-safe diarienummer and filing it
*is* the diarium's reason to exist. Coordinating it is not a convenience bolted onto the tracker — it
is the core soul of a diarie, and the tracker is uniquely placed to own it.

The adversarial rounds correctly killed one justification: *collision-checking* is a non-problem —
`grep -rn 'id:' .diarie/` spans every surface, decision/doc ids are their filenames, and `validate`
plus a single-slug store make within-file uniqueness global. But that is about *detecting* a clash
after you pick an id. Argument 3 is about *generating* a good id in the first place, which those
findings never touched.

## Implementation constraint (the real work)

Persisting into a fresh store means the write must be a **targeted edit that preserves bytes** — the
comment header, existing rows, and their ordering — never a `js-yaml` load-then-dump, which would
flatten the header. The `tasks: []` fresh-store anchor is the sharp corner: the first registration
must rewrite that one flow-style line into a block sequence, and that is the *only* existing-content
change `register` is permitted — allowed only because it touches the container, not a case. Writes
are atomic, one owner per `tasks-<slug>.yml`. Tracked as task `diarie-rgc`.

## Alternatives Considered

- **No write verb (status quo)** — the README's stated stance ("There is no `diarie add`… not an
  omission"). Declined: it conflates *registration* (the diarium's job) with *revision* (yours), and
  leaves the merge-safe-id ceremony unaided for humans and agents alike.
- **`diarie stamp`, emit-only (write nothing)** — declined: it withholds persistence, which
  argument 2 shows is the act that makes a diarienummer real, and its id-*verification*
  justification was refuted.
- **A general CRUD layer (`add`/`close`/`assign`)** — declined, unchanged: those encode a lifecycle
  opinion and would make diarie the owner of your data. `register` is bounded at create and is
  optional, so ownership stays with the files.
- **Name `add`/`new`/`stamp`** — `register` chosen: it names both the boundary (register vs revise)
  and the metaphor (diarieföring); `add` also collides with the README's explicit "no `diarie add`".

## Affects

- New `lib/commands/register.js` (four-part shape) + `cli.js` wiring; id generation deriving its
  shape from `lib/schema.js` `ID_RE`, never forking it — task `diarie-rgc`.
- README "## The write side is your editor" must be rewritten from "no writes" to the
  register-vs-revise boundary; CLAUDE.md's "no CRUD helper" line likewise. Do these in the change
  that ships the command, not before — the prose must not claim a command that does not exist yet.
- Records the id-scheme rationale (short + consistent + branch-merge-safe; auto-increment banned)
  that until now lived only as unwritten intent.
