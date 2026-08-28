const test = require('node:test');
const assert = require('node:assert/strict');

const { parseKnownLabels } = require('./parse-known-labels');
const { extractLabelStates } = require('./extract-label-states');
const {
  parseConditions,
  evaluateReadyToMerge,
  ALL_CONDITIONS,
} = require('./evaluate-ready-to-merge');
const { resolvePullRequests } = require('./resolve-pull-requests');
const applyLabels = require('./apply-labels');

function makeCore() {
  const infos = [];
  const failures = [];
  return {
    info: (msg) => infos.push(msg),
    setFailed: (msg) => failures.push(msg),
    infos,
    failures,
  };
}

function makeGithub({
  currentLabels = [],
  throwOnRemove,
  checkRuns = [],
  combinedStatus = { state: 'success', total_count: 0 },
  reviews = [],
  prGetData,
  prGetByNumber,
  openPullRequests = [],
} = {}) {
  const calls = {
    addLabels: [],
    removeLabel: [],
    listLabelsOnIssue: [],
    listChecks: [],
    getCombinedStatus: [],
    listReviews: [],
    pullsGet: [],
    pullsList: [],
  };
  return {
    calls,
    rest: {
      issues: {
        listLabelsOnIssue: async (args) => {
          calls.listLabelsOnIssue.push(args);
          return { data: currentLabels.map((name) => ({ name })) };
        },
        addLabels: async (args) => {
          calls.addLabels.push(args);
        },
        removeLabel: async (args) => {
          calls.removeLabel.push(args);
          if (throwOnRemove && throwOnRemove[args.name]) {
            throw throwOnRemove[args.name];
          }
        },
      },
      pulls: {
        get: async (args) => {
          calls.pullsGet.push(args);
          if (prGetByNumber && prGetByNumber[args.pull_number]) {
            return { data: prGetByNumber[args.pull_number] };
          }
          return { data: prGetData || {} };
        },
        listReviews: async (args) => {
          calls.listReviews.push(args);
          return { data: reviews };
        },
        list: async (args) => {
          calls.pullsList.push(args);
          return { data: openPullRequests };
        },
      },
      checks: {
        listForRef: async (args) => {
          calls.listChecks.push(args);
          return { data: { total_count: checkRuns.length, check_runs: checkRuns } };
        },
      },
      repos: {
        getCombinedStatusForRef: async (args) => {
          calls.getCombinedStatus.push(args);
          return { data: combinedStatus };
        },
      },
    },
  };
}

function makeContext({
  body = '',
  prNumber = 42,
  owner = 'o',
  repo = 'r',
  draft = false,
  mergeable = true,
  headSha = 'deadbeef',
  workflow,
  job,
} = {}) {
  return {
    workflow,
    job,
    repo: { owner, repo },
    payload: {
      pull_request: {
        number: prNumber,
        body,
        draft,
        mergeable,
        head: { sha: headSha },
      },
    },
  };
}

test('parseKnownLabels trims, lowercases, and drops empties', () => {
  assert.deepEqual(
    parseKnownLabels('bug, Chore ,,FEATURE ,  '),
    ['bug', 'chore', 'feature'],
  );
});

test('parseKnownLabels returns [] for empty/nullish input', () => {
  assert.deepEqual(parseKnownLabels(''), []);
  assert.deepEqual(parseKnownLabels(undefined), []);
  assert.deepEqual(parseKnownLabels(null), []);
});

test('extractLabelStates handles [ ], [x], [X] and both list markers', () => {
  const body = [
    '- [x] bug',
    '* [ ] chore',
    '- [X] Feature',
    '   -   [x]   Dependencies   ',
  ].join('\n');
  const { checked, unchecked } = extractLabelStates(body, [
    'bug', 'chore', 'feature', 'dependencies',
  ]);
  assert.deepEqual([...checked].sort(), ['bug', 'dependencies', 'feature']);
  assert.deepEqual([...unchecked], ['chore']);
});

test('extractLabelStates ignores unknown labels and non-checkbox lines', () => {
  const body = [
    '- [x] bug',
    '- [x] not-a-known-label',
    'some prose - [x] feature',
    '- [y] chore',
  ].join('\n');
  const { checked, unchecked } = extractLabelStates(body, ['bug', 'chore', 'feature']);
  assert.deepEqual([...checked], ['bug']);
  assert.deepEqual([...unchecked], []);
});

test('extractLabelStates on empty body returns empty sets', () => {
  const { checked, unchecked } = extractLabelStates('', ['bug']);
  assert.equal(checked.size, 0);
  assert.equal(unchecked.size, 0);
});

test('applyLabels fails when labels input is empty', async () => {
  const core = makeCore();
  await applyLabels({
    github: makeGithub(),
    context: makeContext(),
    core,
    labelsInput: '   ',
    ready_to_merge_label: '',
  });
  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /No labels provided/);
});

test('applyLabels fails when the event has no resolvable PR', async () => {
  const core = makeCore();
  await applyLabels({
    github: makeGithub(),
    context: { repo: { owner: 'o', repo: 'r' }, payload: {} },
    core,
    labelsInput: 'bug',
    ready_to_merge_label: '',
  });
  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /pull request/i);
});

test('applyLabels adds checked labels that are missing', async () => {
  const core = makeCore();
  const github = makeGithub({ currentLabels: [] });
  await applyLabels({
    github,
    context: makeContext({ body: '- [x] bug\n- [x] feature\n- [ ] chore' }),
    core,
    labelsInput: 'bug, chore, feature',
    ready_to_merge_label: '',
  });
  assert.equal(github.calls.addLabels.length, 1);
  assert.deepEqual(github.calls.addLabels[0].labels.sort(), ['bug', 'feature']);
  assert.equal(github.calls.removeLabel.length, 0);
});

test('applyLabels removes unchecked labels that are currently applied', async () => {
  const core = makeCore();
  const github = makeGithub({ currentLabels: ['bug', 'chore'] });
  await applyLabels({
    github,
    context: makeContext({ body: '- [x] bug\n- [ ] chore' }),
    core,
    labelsInput: 'bug, chore',
    ready_to_merge_label: '',
  });
  assert.equal(github.calls.addLabels.length, 0);
  assert.equal(github.calls.removeLabel.length, 1);
  assert.equal(github.calls.removeLabel[0].name, 'chore');
});

test('applyLabels does nothing when state already matches', async () => {
  const core = makeCore();
  const github = makeGithub({ currentLabels: ['bug'] });
  await applyLabels({
    github,
    context: makeContext({ body: '- [x] bug\n- [ ] chore' }),
    core,
    labelsInput: 'bug, chore',
    ready_to_merge_label: '',
  });
  assert.equal(github.calls.addLabels.length, 0);
  assert.equal(github.calls.removeLabel.length, 0);
  assert.ok(core.infos.some((m) => /No label changes needed/.test(m)));
});

test('applyLabels fails when no label selected and fail_on_no_label is true', async () => {
  const core = makeCore();
  const github = makeGithub({ currentLabels: [] });
  await applyLabels({
    github,
    context: makeContext({ body: '- [ ] bug\n- [ ] chore' }),
    core,
    labelsInput: 'bug, chore',
    fail_on_no_label: 'true',
    ready_to_merge_label: '',
  });
  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /No label selected/);
});

test('applyLabels does not fail when no label selected and fail_on_no_label is false', async () => {
  const core = makeCore();
  const github = makeGithub({ currentLabels: [] });
  await applyLabels({
    github,
    context: makeContext({ body: '- [ ] bug\n- [ ] chore' }),
    core,
    labelsInput: 'bug, chore',
    fail_on_no_label: 'false',
    ready_to_merge_label: '',
  });
  assert.equal(core.failures.length, 0);
  assert.ok(core.infos.some((m) => /No label changes needed/.test(m)));
});

test('applyLabels swallows 404 on removeLabel but rethrows other errors', async () => {
  const core = makeCore();
  const notFound = Object.assign(new Error('not found'), { status: 404 });
  const github = makeGithub({
    currentLabels: ['chore'],
    throwOnRemove: { chore: notFound },
  });
  await applyLabels({
    github,
    context: makeContext({ body: '- [ ] chore' }),
    core,
    labelsInput: 'chore',
    ready_to_merge_label: '',
  });
  assert.equal(github.calls.removeLabel.length, 1);

  const core2 = makeCore();
  const boom = Object.assign(new Error('boom'), { status: 500 });
  const github2 = makeGithub({
    currentLabels: ['chore'],
    throwOnRemove: { chore: boom },
  });
  await assert.rejects(
    applyLabels({
      github: github2,
      context: makeContext({ body: '- [ ] chore' }),
      core: core2,
      labelsInput: 'chore',
      ready_to_merge_label: '',
    }),
    /boom/,
  );
});

test('applyLabels ignores labels not in the known list', async () => {
  const core = makeCore();
  const github = makeGithub({ currentLabels: ['security'] });
  await applyLabels({
    github,
    context: makeContext({ body: '- [x] bug\n- [x] security' }),
    core,
    labelsInput: 'bug',
    ready_to_merge_label: '',
  });
  assert.deepEqual(github.calls.addLabels[0].labels, ['bug']);
  assert.equal(github.calls.removeLabel.length, 0);
});

// ---------- parseConditions ----------

test('parseConditions returns all conditions on empty/nullish input', () => {
  assert.deepEqual(parseConditions(undefined).conditions, [...ALL_CONDITIONS]);
  assert.deepEqual(parseConditions(null).conditions, [...ALL_CONDITIONS]);
  assert.deepEqual(parseConditions('').conditions, [...ALL_CONDITIONS]);
  assert.deepEqual(parseConditions('   ').conditions, [...ALL_CONDITIONS]);
});

test('parseConditions parses, lowercases, dedupes, and separates unknowns', () => {
  const { conditions, unknown } = parseConditions(
    'Not_Draft, mergeable, mergeable, bogus , approved,, another_bad'
  );
  assert.deepEqual(conditions, ['not_draft', 'mergeable', 'approved']);
  assert.deepEqual(unknown.sort(), ['another_bad', 'bogus']);
});

// ---------- evaluateReadyToMerge ----------

function evalCtx({ workflow, job } = {}) {
  return { workflow, job, repo: { owner: 'o', repo: 'r' } };
}

function evalPr({ draft = false, mergeable = true, headSha = 'sha1', number = 7 } = {}) {
  return { number, draft, mergeable, head: { sha: headSha } };
}

test('evaluateReadyToMerge: all conditions met -> ready', async () => {
  const github = makeGithub({
    checkRuns: [
      { name: 'ci', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'completed', conclusion: 'skipped' },
    ],
    combinedStatus: { state: 'success', total_count: 0 },
    reviews: [{ user: { login: 'r1' }, state: 'APPROVED' }],
  });
  const result = await evaluateReadyToMerge({
    github,
    context: evalCtx(),
    pr: evalPr(),
    conditions: [...ALL_CONDITIONS],
    checkedLabelsCount: 1,
    core: makeCore(),
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.reasons, []);
});

test('evaluateReadyToMerge: draft PR -> not ready', async () => {
  const github = makeGithub();
  const result = await evaluateReadyToMerge({
    github,
    context: evalCtx(),
    pr: evalPr({ draft: true }),
    conditions: ['not_draft'],
    checkedLabelsCount: 1,
    core: makeCore(),
  });
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((r) => /draft/i.test(r)));
});

test('evaluateReadyToMerge: merge conflicts -> not ready', async () => {
  const github = makeGithub();
  const result = await evaluateReadyToMerge({
    github,
    context: evalCtx(),
    pr: evalPr({ mergeable: false }),
    conditions: ['mergeable'],
    checkedLabelsCount: 1,
    core: makeCore(),
  });
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((r) => /conflict/i.test(r)));
});

test('evaluateReadyToMerge: fetches PR when mergeable is null', async () => {
  const github = makeGithub({
    prGetData: { mergeable: true },
  });
  const result = await evaluateReadyToMerge({
    github,
    context: evalCtx(),
    pr: evalPr({ mergeable: null }),
    conditions: ['mergeable'],
    checkedLabelsCount: 1,
    core: makeCore(),
  });
  assert.equal(github.calls.pullsGet.length, 1);
  assert.equal(result.ready, true);
});

test('evaluateReadyToMerge: pending / failing checks -> not ready', async () => {
  const github = makeGithub({
    checkRuns: [
      { name: 'ci', status: 'completed', conclusion: 'failure' },
      { name: 'slow', status: 'in_progress', conclusion: null },
    ],
  });
  const result = await evaluateReadyToMerge({
    github,
    context: evalCtx(),
    pr: evalPr(),
    conditions: ['checks_passing'],
    checkedLabelsCount: 1,
    core: makeCore(),
  });
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((r) => /pending/i.test(r)));
  assert.ok(result.reasons.some((r) => /not passing/i.test(r)));
});

test('evaluateReadyToMerge: skips own workflow/job check runs', async () => {
  const github = makeGithub({
    checkRuns: [
      { name: 'label', status: 'in_progress', conclusion: null },
      { name: 'ci', status: 'completed', conclusion: 'success' },
    ],
  });
  const result = await evaluateReadyToMerge({
    github,
    context: evalCtx({ workflow: 'Autolabeler', job: 'label' }),
    pr: evalPr(),
    conditions: ['checks_passing'],
    checkedLabelsCount: 1,
    core: makeCore(),
  });
  assert.equal(result.ready, true);
});

test('evaluateReadyToMerge: failing combined status -> not ready', async () => {
  const github = makeGithub({
    combinedStatus: { state: 'failure', total_count: 1 },
  });
  const result = await evaluateReadyToMerge({
    github,
    context: evalCtx(),
    pr: evalPr(),
    conditions: ['checks_passing'],
    checkedLabelsCount: 1,
    core: makeCore(),
  });
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((r) => /combined status/i.test(r)));
});

test('evaluateReadyToMerge: no approvals -> not ready', async () => {
  const github = makeGithub({ reviews: [] });
  const result = await evaluateReadyToMerge({
    github,
    context: evalCtx(),
    pr: evalPr(),
    conditions: ['approved'],
    checkedLabelsCount: 1,
    core: makeCore(),
  });
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((r) => /approving/i.test(r)));
});

test('evaluateReadyToMerge: outstanding changes-requested -> not ready', async () => {
  const github = makeGithub({
    reviews: [
      { user: { login: 'r1' }, state: 'APPROVED' },
      { user: { login: 'r2' }, state: 'CHANGES_REQUESTED' },
    ],
  });
  const result = await evaluateReadyToMerge({
    github,
    context: evalCtx(),
    pr: evalPr(),
    conditions: ['approved'],
    checkedLabelsCount: 1,
    core: makeCore(),
  });
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((r) => /changes-requested/i.test(r)));
});

test('evaluateReadyToMerge: uses only latest review per reviewer', async () => {
  const github = makeGithub({
    reviews: [
      { user: { login: 'r1' }, state: 'CHANGES_REQUESTED' },
      { user: { login: 'r1' }, state: 'APPROVED' },
    ],
  });
  const result = await evaluateReadyToMerge({
    github,
    context: evalCtx(),
    pr: evalPr(),
    conditions: ['approved'],
    checkedLabelsCount: 1,
    core: makeCore(),
  });
  assert.equal(result.ready, true);
});

test('evaluateReadyToMerge: no known labels selected -> not ready', async () => {
  const github = makeGithub();
  const result = await evaluateReadyToMerge({
    github,
    context: evalCtx(),
    pr: evalPr(),
    conditions: ['at_least_one_label'],
    checkedLabelsCount: 0,
    core: makeCore(),
  });
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((r) => /No known labels/i.test(r)));
});

test('evaluateReadyToMerge: disabled conditions are skipped', async () => {
  // Draft, no mergeable, no reviews, no labels -- but only checks_passing enabled.
  const github = makeGithub();
  const result = await evaluateReadyToMerge({
    github,
    context: evalCtx(),
    pr: evalPr({ draft: true, mergeable: false }),
    conditions: ['checks_passing'],
    checkedLabelsCount: 0,
    core: makeCore(),
  });
  assert.equal(result.ready, true);
});

// ---------- applyLabels + Ready to Merge integration ----------

test('applyLabels adds Ready to Merge when all conditions pass', async () => {
  const core = makeCore();
  const github = makeGithub({
    currentLabels: ['bug'],
    checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
    reviews: [{ user: { login: 'r1' }, state: 'APPROVED' }],
  });
  await applyLabels({
    github,
    context: makeContext({ body: '- [x] bug' }),
    core,
    labelsInput: 'bug, chore',
  });
  const addedLabelSets = github.calls.addLabels.map((c) => c.labels);
  assert.ok(addedLabelSets.some((l) => l.includes('Ready to Merge')));
});

test('applyLabels does NOT add Ready to Merge when a condition fails', async () => {
  const core = makeCore();
  const github = makeGithub({
    currentLabels: [],
    checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'failure' }],
    reviews: [{ user: { login: 'r1' }, state: 'APPROVED' }],
  });
  await applyLabels({
    github,
    context: makeContext({ body: '- [x] bug' }),
    core,
    labelsInput: 'bug',
  });
  const addedLabelSets = github.calls.addLabels.map((c) => c.labels);
  assert.ok(!addedLabelSets.some((l) => l.includes('Ready to Merge')));
  assert.equal(github.calls.removeLabel.length, 0);
});

test('applyLabels removes Ready to Merge when conditions no longer met', async () => {
  const core = makeCore();
  const github = makeGithub({
    currentLabels: ['bug', 'Ready to Merge'],
    checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'failure' }],
    reviews: [{ user: { login: 'r1' }, state: 'APPROVED' }],
  });
  await applyLabels({
    github,
    context: makeContext({ body: '- [x] bug' }),
    core,
    labelsInput: 'bug',
  });
  assert.equal(github.calls.removeLabel.length, 1);
  assert.equal(github.calls.removeLabel[0].name, 'Ready to Merge');
});

test('applyLabels does not add Ready to Merge when already present', async () => {
  const core = makeCore();
  const github = makeGithub({
    currentLabels: ['bug', 'Ready to Merge'],
    checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
    reviews: [{ user: { login: 'r1' }, state: 'APPROVED' }],
  });
  await applyLabels({
    github,
    context: makeContext({ body: '- [x] bug' }),
    core,
    labelsInput: 'bug',
  });
  const addedLabelSets = github.calls.addLabels.map((c) => c.labels);
  assert.ok(!addedLabelSets.some((l) => l.includes('Ready to Merge')));
});

test('applyLabels honors custom ready_to_merge_label', async () => {
  const core = makeCore();
  const github = makeGithub({
    currentLabels: ['bug'],
    checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
    reviews: [{ user: { login: 'r1' }, state: 'APPROVED' }],
  });
  await applyLabels({
    github,
    context: makeContext({ body: '- [x] bug' }),
    core,
    labelsInput: 'bug',
    ready_to_merge_label: 'shippable',
  });
  const addedLabelSets = github.calls.addLabels.map((c) => c.labels);
  assert.ok(addedLabelSets.some((l) => l.includes('shippable')));
});

test('applyLabels honors ready_to_merge_conditions subset', async () => {
  const core = makeCore();
  // No reviews and no labels checked, but only not_draft + mergeable required.
  const github = makeGithub({
    currentLabels: [],
    reviews: [],
    checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'failure' }],
  });
  await applyLabels({
    github,
    context: makeContext({ body: '- [ ] bug' }),
    core,
    labelsInput: 'bug',
    ready_to_merge_conditions: 'not_draft, mergeable',
  });
  const addedLabelSets = github.calls.addLabels.map((c) => c.labels);
  assert.ok(addedLabelSets.some((l) => l.includes('Ready to Merge')));
});

test('applyLabels does not manage Ready to Merge when feature disabled', async () => {
  const core = makeCore();
  const github = makeGithub({
    currentLabels: ['bug', 'Ready to Merge'],
    checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'failure' }],
  });
  await applyLabels({
    github,
    context: makeContext({ body: '- [x] bug' }),
    core,
    labelsInput: 'bug',
    ready_to_merge_label: '',
  });
  assert.equal(github.calls.removeLabel.length, 0);
  assert.equal(github.calls.listChecks.length, 0);
  assert.equal(github.calls.listReviews.length, 0);
});

// ---------- resolvePullRequests ----------

function ctxWithPayload(payload, { owner = 'o', repo = 'r' } = {}) {
  return { repo: { owner, repo }, payload };
}

test('resolvePullRequests: uses payload.pull_request when present', async () => {
  const github = makeGithub();
  const pr = { number: 1, body: '', head: { sha: 'a' } };
  const result = await resolvePullRequests({
    github,
    context: ctxWithPayload({ pull_request: pr }),
    core: makeCore(),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0], pr);
  assert.equal(github.calls.pullsGet.length, 0);
});

test('resolvePullRequests: fetches PR from check_suite.pull_requests', async () => {
  const github = makeGithub({
    prGetByNumber: {
      17: { number: 17, body: '- [x] bug', head: { sha: 'sha17' }, mergeable: true },
    },
  });
  const result = await resolvePullRequests({
    github,
    context: ctxWithPayload({
      check_suite: {
        head_sha: 'sha17',
        pull_requests: [
          { number: 17, base: { repo: { owner: { login: 'o' }, name: 'r' } } },
        ],
      },
    }),
    core: makeCore(),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].number, 17);
  assert.equal(github.calls.pullsGet[0].pull_number, 17);
});

test('resolvePullRequests: prefers same-repo PRs from embedded refs', async () => {
  const github = makeGithub({
    prGetByNumber: {
      5: { number: 5, head: { sha: 'x' } },
    },
  });
  const result = await resolvePullRequests({
    github,
    context: ctxWithPayload({
      check_suite: {
        head_sha: 'x',
        pull_requests: [
          { number: 99, base: { repo: { owner: { login: 'other' }, name: 'fork' } } },
          { number: 5, base: { repo: { owner: { login: 'o' }, name: 'r' } } },
        ],
      },
    }),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].number, 5);
});

test('resolvePullRequests: falls back to listing open PRs by head SHA (forks)', async () => {
  const github = makeGithub({
    openPullRequests: [
      { number: 2, head: { sha: 'other' } },
      { number: 3, head: { sha: 'target' } },
    ],
    prGetByNumber: {
      3: { number: 3, head: { sha: 'target' } },
    },
  });
  const result = await resolvePullRequests({
    github,
    context: ctxWithPayload({
      check_suite: { head_sha: 'target', pull_requests: [] },
    }),
    core: makeCore(),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].number, 3);
  assert.equal(github.calls.pullsList.length, 1);
});

test('resolvePullRequests: resolves status event via payload.sha', async () => {
  const github = makeGithub({
    openPullRequests: [{ number: 8, head: { sha: 'statussha' } }],
    prGetByNumber: { 8: { number: 8, head: { sha: 'statussha' } } },
  });
  const result = await resolvePullRequests({
    github,
    context: ctxWithPayload({ sha: 'statussha' }),
    core: makeCore(),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].number, 8);
});

test('resolvePullRequests: returns [] when nothing resolves', async () => {
  const github = makeGithub({ openPullRequests: [] });
  const result = await resolvePullRequests({
    github,
    context: ctxWithPayload({}),
    core: makeCore(),
  });
  assert.deepEqual(result, []);
});

test('applyLabels processes PR resolved from a check_suite event', async () => {
  const core = makeCore();
  const github = makeGithub({
    currentLabels: [],
    checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
    reviews: [{ user: { login: 'r1' }, state: 'APPROVED' }],
    prGetByNumber: {
      42: {
        number: 42,
        body: '- [x] bug',
        draft: false,
        mergeable: true,
        head: { sha: 'headsha' },
      },
    },
  });
  await applyLabels({
    github,
    context: ctxWithPayload({
      check_suite: {
        head_sha: 'headsha',
        pull_requests: [
          { number: 42, base: { repo: { owner: { login: 'o' }, name: 'r' } } },
        ],
      },
    }),
    core,
    labelsInput: 'bug',
  });
  const addedLabelSets = github.calls.addLabels.map((c) => c.labels);
  assert.ok(addedLabelSets.some((l) => l.includes('bug')));
  assert.ok(addedLabelSets.some((l) => l.includes('Ready to Merge')));
});

