const test = require('node:test');
const assert = require('node:assert/strict');

const { parseKnownLabels } = require('./parse-known-labels');
const { extractLabelStates } = require('./extract-label-states');
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

function makeGithub({ currentLabels = [], throwOnRemove } = {}) {
  const calls = { addLabels: [], removeLabel: [], listLabelsOnIssue: [] };
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
    },
  };
}

function makeContext({ body = '', prNumber = 42, owner = 'o', repo = 'r' } = {}) {
  return {
    repo: { owner, repo },
    payload: { pull_request: { number: prNumber, body } },
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
  });
  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /No labels provided/);
});

test('applyLabels fails when not a pull_request event', async () => {
  const core = makeCore();
  await applyLabels({
    github: makeGithub(),
    context: { repo: { owner: 'o', repo: 'r' }, payload: {} },
    core,
    labelsInput: 'bug',
  });
  assert.equal(core.failures.length, 1);
  assert.match(core.failures[0], /pull_request/);
});

test('applyLabels adds checked labels that are missing', async () => {
  const core = makeCore();
  const github = makeGithub({ currentLabels: [] });
  await applyLabels({
    github,
    context: makeContext({ body: '- [x] bug\n- [x] feature\n- [ ] chore' }),
    core,
    labelsInput: 'bug, chore, feature',
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
  });
  assert.deepEqual(github.calls.addLabels[0].labels, ['bug']);
  assert.equal(github.calls.removeLabel.length, 0);
});
