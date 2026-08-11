const { parseKnownLabels } = require('./parse-known-labels');
const { extractLabelStates } = require('./extract-label-states');

module.exports = async function applyLabels({ github, context, core, labelsInput, fail_on_no_label }) {
  const known = parseKnownLabels(labelsInput);
  const failWhenNoLabel = String(fail_on_no_label || '').toLowerCase() === 'true';
  if (known.length === 0) {
    core.setFailed('No labels provided. Pass a comma-separated list via the `labels` input.');
    return;
  }
  core.info(`Known labels: ${known.join(', ')}`);

  const pr = context.payload.pull_request;
  if (!pr) {
    core.setFailed('This action must be run from a pull_request or pull_request_target event.');
    return;
  }

  const body = pr.body || '';
  const { checked, unchecked } = extractLabelStates(body, known);

  if (checked.size === 0 && failWhenNoLabel) {
    core.setFailed('No label selected in the PR template. Please select at least one label.');
    return;
  }

  const { owner, repo } = context.repo;
  const prNumber = pr.number;

  const current = await github.rest.issues.listLabelsOnIssue({
    owner, repo, issue_number: prNumber,
  });
  const currentNames = new Set(current.data.map((l) => l.name));

  const toAdd = [...checked].filter((l) => !currentNames.has(l));
  const toRemove = [...unchecked].filter((l) => currentNames.has(l) && !checked.has(l));

  if (toAdd.length > 0) {
    core.info(`Adding labels: ${toAdd.join(', ')}`);
    await github.rest.issues.addLabels({
      owner, repo, issue_number: prNumber, labels: toAdd,
    });
  }

  for (const label of toRemove) {
    core.info(`Removing label: ${label}`);
    try {
      await github.rest.issues.removeLabel({
        owner, repo, issue_number: prNumber, name: label,
      });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }

  if (toAdd.length === 0 && toRemove.length === 0) {
    core.info('No label changes needed.');
  }
};
