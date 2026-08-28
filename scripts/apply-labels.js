const { parseKnownLabels } = require('./parse-known-labels');
const { extractLabelStates } = require('./extract-label-states');
const { parseConditions, evaluateReadyToMerge } = require('./evaluate-ready-to-merge');

module.exports = async function applyLabels({
  github,
  context,
  core,
  labelsInput,
  fail_on_no_label,
  ready_to_merge_label,
  ready_to_merge_conditions,
}) {
  const failWhenNoLabel = String(fail_on_no_label || '').toLowerCase() === 'true';

  const readyLabelRaw = ready_to_merge_label === undefined || ready_to_merge_label === null
    ? 'Ready to Merge'
    : String(ready_to_merge_label);
  const readyLabel = readyLabelRaw.trim();
  const readyFeatureEnabled = readyLabel.length > 0;
  const readyLabelLower = readyLabel.toLowerCase();

  const allKnown = parseKnownLabels(labelsInput);
  const known = allKnown.filter((l) => l !== readyLabelLower);
  if (known.length === 0) {
    core.setFailed('No labels provided. Pass a comma-separated list via the `labels` input.');
    return;
  }
  core.info(`Known labels: ${known.join(', ')}`);
  if (readyFeatureEnabled) {
    core.info(`Ready-to-merge label: ${readyLabel}`);
  }

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
  const currentNamesLower = new Set([...currentNames].map((n) => n.toLowerCase()));

  const toAdd = [...checked].filter((l) => !currentNamesLower.has(l));
  const toRemove = [...unchecked].filter((l) => currentNamesLower.has(l) && !checked.has(l));

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

  if (!readyFeatureEnabled) {
    core.info('Ready-to-merge feature disabled (empty ready_to_merge_label).');
    return;
  }

  const { conditions, unknown: unknownConditions } = parseConditions(ready_to_merge_conditions);
  if (unknownConditions.length > 0) {
    core.info(`Ignoring unknown ready_to_merge_conditions: ${unknownConditions.join(', ')}`);
  }
  if (conditions.length === 0) {
    core.info('No ready_to_merge_conditions configured; skipping ready-to-merge evaluation.');
    return;
  }
  core.info(`Ready-to-merge conditions: ${conditions.join(', ')}`);

  const { ready, reasons } = await evaluateReadyToMerge({
    github,
    context,
    pr,
    conditions,
    checkedLabelsCount: checked.size,
    core,
  });

  const readyLabelPresent = currentNamesLower.has(readyLabelLower);

  if (ready) {
    core.info('PR meets all ready-to-merge conditions.');
    if (!readyLabelPresent) {
      core.info(`Adding label: ${readyLabel}`);
      await github.rest.issues.addLabels({
        owner, repo, issue_number: prNumber, labels: [readyLabel],
      });
    } else {
      core.info(`Label "${readyLabel}" already present.`);
    }
  } else {
    core.info(`PR is not ready to merge: ${reasons.join('; ')}`);
    if (readyLabelPresent) {
      core.info(`Removing label: ${readyLabel}`);
      try {
        await github.rest.issues.removeLabel({
          owner, repo, issue_number: prNumber, name: readyLabel,
        });
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    }
  }
};
