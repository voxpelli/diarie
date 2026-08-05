/**
 * validate.js — the integrity gate.
 *
 * PURE: `lintTasks()` and `lintRecords()` take already-parsed input and return
 * errors/warnings. No filesystem, no process, no exit codes. `commands/validate.js` does the
 * IO and owns the exit codes; `store/root.js` owns finding the store.
 *
 * TWO linters, not one, and the split is deliberate — see `lintRecords`. Rows live in
 * `tasks-<slug>.yml` and carry a slug; records are whole files under `decisions/`/`docs/`
 * and carry none. The field rules they share are `lintFields`; nothing else is shared,
 * because everything else would have to invent a slug for a record to borrow it.
 *
 * `lintTasks`' four passes:
 *   1. per-file structural — required fields, enum values, unique ids
 *   2. dep-graph integrity — dangling deps, orphan parents, no cycles (Kahn)
 *   3. status-transition sanity — claimed-before-blockers, ghost claims
 *   4. test-ratchet — completed work units must state their acceptance criteria
 *
 * Honest scope: this catches dep-graph rot at check time — the same guarantee
 * `bd graph check` gave (a snapshot, not a structural invariant). It cannot
 * make an agent write its plan-updates back; it makes the rot visible within
 * one `npm run check`.
 *
 * NOT substrate-optional any more. It used to exit 0 with `{clean:true,
 * skipped:true}` when no store existed — which made an ABSENT store and a CLEAN
 * one indistinguishable, and forced `beads-probe` to test `skipped === false` just
 * to know whether the gate had been real. A missing store is now ENOSTORE and a
 * non-zero exit; the `skipped` flag is gone with the defect it papered over. An
 * EMPTY store is still perfectly clean — see `store/root.js`.
 */

import {
  isObject, isStringArray, isType, typesafeIsArray,
} from '@voxpelli/typed-utils';

import { renderRejected } from './format.js';
import { isUsableId, isUsableRef } from './ids.js';
import {
  ID_RE, IS_RATCHETING_TYPE, isNil, isPriority, isStatus, isTaskType, nsId, REQUIRED_FIELDS,
  STRING_FIELDS,
} from './schema.js';

/**
 * @import { GlobalId } from './schema.js'
 */

/**
 * A task entry exactly as YAML handed it over: known keys, UNKNOWN values.
 *
 * `Record<string, unknown>`, not `any`. The values genuinely are unknown — that is this
 * file's entire subject — but the KEYS are not, and `any` was throwing both away. Under
 * `any`, renaming a schema field would make every check on it silently read `undefined`
 * and stop checking, while `npm run check` stayed green: the same silent-no-op class that
 * produced every other bug in this tracker, sitting inside the gate meant to catch them.
 *
 * @typedef {Record<string, unknown>} RawTask
 */

/**
 * If a dangling BARE dep matches a task id in a different slug, suggest it —
 * the most common copy-paste error (a task moved between files keeps bare deps).
 *
 * @param {unknown} rawDep    the dep exactly as written (bare or `slug/id`)
 * @param {string} resolved   the globalized id that failed to resolve
 * @param {Map<string, { t: RawTask, slug: string }>} all
 * @returns {string}
 */
function crossSlugHint (rawDep, resolved, all) {
  if (String(rawDep).includes('/')) return '';
  const match = [...all.keys()].find(k => k !== resolved && k.endsWith(`/${rawDep}`));
  return match ? ` (did you mean ${match}?)` : '';
}

/**
 * The field checks a task ROW and a record's FRONTMATTER share, exactly.
 *
 * Extracted when `validate` grew an opinion about `decisions/` and `docs/`, and deliberately
 * NOT extended past the identical part: identity (`nsId`, the per-file duplicate set) and the
 * dep graph stay with Pass 1, because records have no slug and never enter that graph. A
 * shared helper with a branch only one caller takes would be weaker than two honest loops —
 * what must not fork is the RULE, and the rules all live in `schema.js` already.
 *
 * What this buys is one site for the id predicate. `bd-map.js` grew a second implementation
 * of "is this a usable id" once already; a records path with a third would have made the
 * eventual convergence a three-way merge instead of a one-line change.
 *
 * @param {RawTask} row
 * @param {string} noun  what to CALL it in the message — `task`, `decision`, `doc`
 * @param {(message: string) => void} err
 * @returns {void}
 */
function lintFields (row, noun, err) {
  const label = row['id'] ?? '(no id)';

  for (const field of REQUIRED_FIELDS) {
    if (isNil(row[field]) || row[field] === '') {
      err(`${noun} ${label} missing required field: ${field}`);
    }
  }

  // TWO CHECKS OVER ONE FIELD, ASKING DIFFERENT QUESTIONS — and only one of them wants to
  // coerce. This one asks "is this a usable id", so it must NOT: `ID_RE.test(String(42))`
  // passes, which is how an unquoted `id: 42` satisfied this gate while the loader minted a
  // `GlobalId` colliding with whatever row carries the string `'42'`.
  //
  // The caller's duplicate check asks the OTHER question — "what will this row be CALLED" —
  // and `String()` is the right answer there, because that is precisely what `nsId` does. It is
  // what makes `id: 1` and `id: '1'` one id rather than two, and it stays. The two coexist: a
  // numeric id now reports both that it is not usable and that it collapses onto its neighbour.
  if (!isNil(row['id']) && !isUsableId(row['id'])) {
    err(`${noun} ${label}: invalid id ${renderRejected(row['id'])} (expected a string matching ${ID_RE.source})`);
  }

  if (!isNil(row['status']) && !isStatus(row['status'])) {
    err(`${noun} ${label}: invalid status "${row['status']}"`);
  }
  if (!isNil(row['type']) && !isTaskType(row['type'])) {
    err(`${noun} ${label}: invalid type "${row['type']}"`);
  }
  if (!isNil(row['priority']) && !isPriority(row['priority'])) {
    err(`${noun} ${label}: invalid priority "${row['priority']}"`);
  }
  if (!isNil(row['updated']) && (!isType(row['updated'], 'string') || !Number.isFinite(Date.parse(row['updated'])))) {
    // `renderRejected`, NOT an interpolation. `${aDate}` is `String(date)` — locale- and
    // timezone-dependent, so the same store reads differently here and on CI (UTC), and any
    // test pinning it is flaky by construction. The loader refuses the same value; both must
    // describe the same bytes the same way, so the rendering has one home in format.js.
    err(`${noun} ${label}: invalid updated ${renderRejected(row['updated'])} (expected an ISO date string)`);
  }

  // THE SECOND GATE ON THE LOADER'S FOUR SILENT DROPS. `REQUIRED_FIELDS` is a PRESENCE
  // check, so `title: 42` satisfies it — the row is neither nil nor empty. The loader now
  // reports these, but `validate` is a separate command with a separate audience (a CI step,
  // `check:tasks`), and the two must agree about what a valid store is.
  //
  // ERRORS, not warnings, on three counts: `updated` directly above is already an error and
  // is *optional*, so a required field being softer would be incoherent; an EMPTY `title` is
  // already an error, so `title: 42` as a warning would make the more confusing input the
  // quieter one; and `check:tasks` runs a bare `validate` with no `--strict`, so a warning
  // would exit 0 and whisper — which is the defect this package exists to kill.
  for (const field of STRING_FIELDS) {
    if (!isNil(row[field]) && !isType(row[field], 'string')) {
      err(`${noun} ${label}: invalid ${field} ${renderRejected(row[field])} (expected a string)`);
    }
  }
}

/**
 * Pure linter over the store's RECORDS — the `decisions/<id>.md` and `docs/<id>.md` files
 * whose frontmatter carries the same schema fields a task row does.
 *
 * Separate from `lintTasks` rather than folded into it, because records are not rows and
 * pretending otherwise would change answers: they have no slug, so `nsId` has nothing to
 * namespace them with, and admitting them to the dep graph would make a task's currently
 * DANGLING dep on a decision id start resolving. Whether a record may satisfy a dep is a
 * real question (`diarie-rel`), and it is not this function's to answer by accident.
 *
 * Frontmatter that failed to PARSE never arrives here — the caller reports that, the same
 * split `lintTasks` uses for unparseable task files.
 *
 * @param {Array<{ name: string, base: string, type: string, data: RawTask }>} records
 *   `name` is store-relative, `base` the filename without `.md`, `type` the type its
 *   DIRECTORY is the home of
 * @returns {{ errors: string[] }}
 */
export function lintRecords (records) {
  /** @type {string[]} */ const errors = [];
  /** @type {Map<string, string>} */ const seen = new Map();

  for (const { base, data, name, type } of records) {
    lintFields(data, type, message => { errors.push(`${name}: ${message}`); });

    // The directory IS the type claim. A `type: task` sitting in `decisions/` is not a
    // harmless mislabel: every reader globs `tasks-*.yml` for work, so the row is invisible
    // to the ready computation no matter what it calls itself — it would claim to be work
    // that can never be offered.
    if (!isNil(data['type']) && data['type'] !== type) {
      errors.push(`${name}: declares type "${data['type']}" but lives in the home of "${type}"`);
    }

    // `<id>.md` is the WRITER's own invariant (`bootstrap.js` writes `decisions/${id}.md`),
    // and nothing has ever checked it. It is load-bearing rather than cosmetic: the filename
    // is how a human finds a record, and the id is how everything else refers to one, so a
    // pair that disagrees means the two lookups land on different files.
    if (!isNil(data['id']) && String(data['id']) !== base) {
      errors.push(`${name}: id "${data['id']}" does not match its filename (expected ${base}.md, or rename the id)`);
    }

    if (!isNil(data['id'])) {
      const id = String(data['id']);
      const first = seen.get(id);
      // ACROSS directories only — filenames are unique within one, so `<id>.md` makes an
      // intra-directory collision unrepresentable. `decisions/x.md` beside `docs/x.md` is
      // the case that survives, and it is one id naming two different things.
      if (first !== undefined) {
        errors.push(`${name}: duplicate record id "${id}" — already used by ${first}`);
      } else {
        seen.set(id, name);
      }
    }
  }

  return { errors };
}

/**
 * Pure linter over loaded task files.
 *
 * @param {Array<{ name: string, tasks: unknown }>} files  `name` is the slug
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function lintTasks (files) {
  /** @type {string[]} */ const errors = [];
  /** @type {string[]} */ const warnings = [];

  /**
   * @param {string} f
   * @param {string} m
   * @returns {void}
   */
  const err = (f, m) => { errors.push(`${f}: ${m}`); };
  /**
   * @param {string} f
   * @param {string} m
   * @returns {void}
   */
  const warn = (f, m) => { warnings.push(`${f}: ${m}`); };

  /** @type {Map<GlobalId, { t: RawTask, slug: string }>} */
  const all = new Map();
  /**
   * Files whose top-level shape is broken — excluded from the value passes.
   *
   * @type {Set<string>}
   */
  const badFiles = new Set();

  // --- Pass 0: shape guard (types, not values) — a wrong YAML shape would
  // otherwise char-split a scalar into nonsense or throw on a non-iterable. ---
  for (const { name, tasks } of files) {
    if (!typesafeIsArray(tasks)) {
      err(name, `top-level "tasks" must be a list (got ${tasks === null ? 'null' : typeof tasks})`);
      badFiles.add(name);
      continue;
    }

    for (const [i, t] of tasks.entries()) {
      if (!isObject(t)) {
        err(name, `task at index ${i} is not a mapping`);
        continue;
      }

      const label = t['id'] ?? `index ${i}`;

      if (!isNil(t['deps'])) {
        if (!typesafeIsArray(t['deps'])) {
          err(name, `task ${label}: "deps" must be a list (got ${typeof t['deps']})`);
        } else {
          // THE ELEMENTS, on the same rule as `acceptance_criteria` and `labels` below — and
          // for the sharper reason. Those two hold prose; a dep holds an IDENTITY, and `nsId`
          // is `String(ref)`, so an unquoted `deps: [42]` does not fail to resolve, it resolves
          // to `<slug>/42` and finds whichever row is named that. The list shape was checked
          // here and the elements were not, so this file was the one gate that could not tell
          // a dependency from a number.
          for (const dep of t['deps']) {
            if (!isUsableRef(dep)) {
              err(name, `task ${label}: dep ${renderRejected(dep)} is not a usable id (expected \`${ID_RE.source}\`, or \`slug/id\` to reach another file)`);
            }
          }
        }
      }

      // `parent` gets the SAME shape check as a dep element, because it is the same kind of
      // thing — a reference minted through `nsId` — and it is the one that bites hardest: an
      // unquoted `parent: 42` does not dangle, it makes whatever row is called `42` into this
      // row's container, moving an untouched task out of `ready` and into `blocked` with a
      // child it never had. Where that row carries an `epic` label the fabricated child also
      // SATISFIES the "epic with no open children" diagnostic, so the typo suppresses the one
      // report that would have named it.
      if (!isNil(t['parent']) && !isUsableRef(t['parent'])) {
        err(name, `task ${label}: parent ${renderRejected(t['parent'])} is not a usable id (expected \`${ID_RE.source}\`, or \`slug/id\` to reach another file)`);
      }

      if (!isNil(t['acceptance_criteria'])) {
        if (!typesafeIsArray(t['acceptance_criteria'])) {
          err(name, `task ${label}: "acceptance_criteria" must be a list (got ${typeof t['acceptance_criteria']})`);
        } else if (!isStringArray(t['acceptance_criteria'])) {
          // The ELEMENTS, not just the container. `labels` was checked this way and
          // `acceptance_criteria` was not — and the gap bit immediately: an unquoted `priority: 2`
          // inside a criterion made YAML parse that element as a MAP, the list stayed an Array,
          // and validate waved it through. Only the loader's reject-warn caught it, on stderr.
          err(name, `task ${label}: "acceptance_criteria" entries must all be strings (an unquoted \`key: value\` becomes a map — quote it)`);
        }
      }

      if (!isNil(t['labels'])) {
        if (!typesafeIsArray(t['labels'])) {
          err(name, `task ${label}: "labels" must be a list (got ${typeof t['labels']})`);
        } else if (!isStringArray(t['labels'])) {
          err(name, `task ${label}: "labels" entries must all be strings`);
        }
      }
    }
  }

  // --- Pass 1: per-file structural (field values) ---
  for (const { name, tasks } of files) {
    if (badFiles.has(name)) continue;
    if (!typesafeIsArray(tasks)) continue;

    // `Set<string>`, holding the STRING form — see the id check below. A `Set<unknown>` of raw
    // values was the same defect the migrator's parse boundary has: two rows are the same id or
    // they are not, and only one of the two answers here can be the loader's.
    /** @type {Set<string>} */
    const seen = new Set();

    for (const t of tasks) {
      if (!isObject(t)) continue; // shape error already reported in Pass 0

      lintFields(t, 'task', message => { err(name, message); });

      if (!isNil(t['id'])) {
        // The STRING form, matching `lintFields`' id check and `nsId`'s namespacing — see the
        // comment there. This closes the WITHIN-FILE, type-mismatched case only: two rows
        // carrying the same id as the same type already errored, and the loader owing a
        // warning when two rows collapse into one `GlobalId` is `diarie-did`.
        const id = String(t['id']);
        if (seen.has(id)) {
          err(name, `duplicate id "${id}" within file`);
        }
        seen.add(id);
        all.set(nsId(t['id'], name), { t, slug: name });
      }
    }
  }

  // --- Pass 2: dep graph (dangling, orphan parent, cycles) ---
  /** @type {Map<GlobalId, GlobalId[]>} */
  const deps = new Map();
  /** @type {Map<GlobalId, GlobalId>} */
  const parents = new Map();

  for (const [gid, { slug, t }] of all) {
    /** @type {GlobalId[]} */
    const resolved = [];

    for (const d of typesafeIsArray(t['deps']) ? t['deps'] : []) {
      // ONE FAULT, ONE MESSAGE. Pass 0 already said this element is not a usable id; adding
      // `dep "demo/42" does not exist` would report the SAME defect a second time, under a
      // name the user never wrote, and send them looking for a missing row instead of a
      // missing pair of quotes.
      if (!isUsableRef(d)) continue;

      const gd = nsId(d, slug);

      if (all.has(gd)) {
        resolved.push(gd);
      } else {
        err(slug, `task ${t['id']}: dep "${gd}" does not exist${crossSlugHint(d, gd, all)}`);
      }
    }

    deps.set(gid, resolved);

    if (isUsableRef(t['parent'])) {
      const gp = nsId(t['parent'], slug);
      if (gp === gid) {
        err(slug, `task ${t['id']}: parent "${gp}" is itself`);
      } else if (!all.has(gp)) {
        err(slug, `task ${t['id']}: parent "${gp}" does not exist`);
      } else {
        parents.set(gid, gp);
      }
    }
  }

  // --- The BLOCKING graph. One check, over the union — not two, over the projections. ---
  //
  // `computeReady` blocks a task on TWO kinds of edge, and they point opposite ways:
  //
  //   a dep       blocks the DEPENDENT   →  edge  task → dep      (finish the dep first)
  //   a child     blocks the PARENT      →  edge  parent → child  (the work is inside it)
  //
  // Checking `deps` and `parents` as SEPARATE graphs was wrong, and wrong in the worst
  // available way: a ring that ALTERNATES edge kinds is acyclic in both projections and
  // cyclic in neither, so every check passed over a backlog that could never be worked.
  // The minimal case is a task that depends on its own epic — an entirely natural thing to
  // write:
  //
  //   EPIC-1 (epic)                    EPIC-1 is blocked by its child T-1
  //   T-1  parent: EPIC-1              T-1 is blocked by its dep EPIC-1
  //        deps:  [EPIC-1]             → neither can ever start
  //
  //   `diarie ready`    → "0 ready, 1 blocked — run `diarie validate` to check for a cycle"
  //   `diarie validate` → "Task validation passed."     ...and the human loops, forever.
  //
  // So build the graph the ready-walk ACTUALLY walks, and check that. Note the parent edge
  // is REVERSED relative to how `parents` stores it (child→parent): it is the parent that
  // gets blocked.
  /** @type {Map<GlobalId, GlobalId[]>} */
  const blocking = new Map();
  /** @type {Map<`${GlobalId}\u0000${GlobalId}`, 'dep' | 'child'>} */
  const edgeKind = new Map();

  /**
   * @param {GlobalId} from
   * @param {GlobalId} to
   * @param {'dep'|'child'} kind
   * @returns {void}
   */
  const addEdge = (from, to, kind) => {
    const list = blocking.get(from);

    if (list) {
      list.push(to);
    } else {
      blocking.set(from, [to]);
    }

    edgeKind.set(`${from}\u0000${to}`, kind);
  };

  for (const [gid, targets] of deps) for (const d of targets) addEdge(gid, d, 'dep');
  for (const [child, parent] of parents) addEdge(parent, child, 'child');
  for (const gid of all.keys()) if (!blocking.has(gid)) blocking.set(gid, []);

  for (const cycle of findCycles(blocking)) {
    const head = cycle[0];
    const { slug } = (head === undefined ? undefined : all.get(head)) ?? { slug: '(graph)' };

    // Name the edge kinds in the path, so the reader can see WHICH relationship to break.
    const path = cycle.map((node, i) => {
      const next = cycle[i + 1];
      return next === undefined
        ? node
        : `${node} ${edgeKind.get(`${node}\u0000${next}`) === 'child' ? '⊃' : '→'} `;
    }).join('');

    const kinds = new Set(cycle.flatMap((n, i) => {
      const next = cycle[i + 1];
      return next === undefined ? [] : edgeKind.get(`${n}\u0000${next}`);
    }));

    const label = kinds.has('child')
      ? (
          kinds.has('dep')
            ? 'blocking cycle (deps ⨯ containment)'
            : 'parent cycle'
        )
      : 'dependency cycle';

    err(slug, `${label}: ${path}  (→ depends on, ⊃ contains)`);
  }

  // --- Pass 3: status-transition sanity ---
  for (const [, { slug, t }] of all) {
    if (t['status'] === 'in_progress') {
      for (const d of typesafeIsArray(t['deps']) ? t['deps'] : []) {
        const dep = all.get(nsId(d, slug))?.t;
        const depStatus = dep?.['status'];

        if (depStatus === 'pending' || depStatus === 'in_progress') {
          warn(slug, `task ${t['id']}: in_progress but dep ${nsId(d, slug)} is ${depStatus} (claimed before blockers resolved)`);
        }
      }
    }
    if (!isNil(t['agent']) && t['status'] === 'pending') {
      warn(slug, `task ${t['id']}: agent "${t['agent']}" set but status is pending (ghost claim — clear agent or claim it)`);
    }
  }

  // --- Pass 4: test-ratchet ---
  for (const [, { slug, t }] of all) {
    if (
      t['status'] === 'completed' &&
      isTaskType(t['type']) &&
      IS_RATCHETING_TYPE[t['type']] &&
      !(
        typesafeIsArray(t['acceptance_criteria']) &&
        t['acceptance_criteria'].length
      )
    ) {
      warn(slug, `task ${t['id']}: completed ${t['type']} with no acceptance_criteria (state done-ness before marking done)`);
    }
  }

  return { errors, warnings };
}

/**
 * Find EVERY disjoint dependency cycle via Kahn's algorithm. `deps` maps each
 * task → its prerequisites (edges point task → prerequisite); in-degree is
 * counted on the prerequisite side, so a node nothing depends on starts at 0 and
 * is removed first. Nodes that never reach in-degree 0 are in a cycle; one
 * representative path is recovered per disjoint cycle component. The recovery
 * order is sorted, so the output is deterministic across runs.
 *
 * @param {Map<GlobalId, GlobalId[]>} deps  task → its prerequisites
 * @returns {GlobalId[][]} one representative path per disjoint cycle (`[]` if acyclic)
 */
function findCycles (deps) {
  const indeg = new Map([...deps.keys()].map(k => [k, 0]));

  for (const ds of deps.values()) for (const d of ds) indeg.set(d, (indeg.get(d) ?? 0) + 1);

  const queue = [...indeg].filter(([, n]) => n === 0).map(([k]) => k);

  /** @type {Set<string>} */
  const removed = new Set();

  /** @type {GlobalId | undefined} */
  let n;

  while ((n = queue.shift()) !== undefined) {
    removed.add(n);

    for (const d of deps.get(n) ?? []) {
      indeg.set(d, (indeg.get(d) ?? 0) - 1);
      if (indeg.get(d) === 0) {
        queue.push(d);
      }
    }
  }
  const stuck = [...deps.keys()]
    .filter(k => !removed.has(k))
    .toSorted();

  if (!stuck.length) return [];

  const inCycle = new Set(stuck);
  /** @type {Set<GlobalId>} */
  const covered = new Set();
  /** @type {GlobalId[][]} */
  const cycles = [];

  for (const start of stuck) {
    if (covered.has(start)) continue;

    /** @type {GlobalId[]} */
    const path = [];
    /** @type {GlobalId | undefined} */
    let cur = start;
    /** @type {Set<GlobalId>} */
    const visited = new Set();

    while (cur && !visited.has(cur)) {
      visited.add(cur);
      path.push(cur);
      cur = (deps.get(cur) ?? []).find(d => inCycle.has(d));
    }
    if (cur) {
      path.push(cur); // close the loop
    }
    for (const node of path) {
      covered.add(node);
    }
    cycles.push(path);
  }

  return cycles;
}
