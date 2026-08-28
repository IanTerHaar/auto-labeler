const ALL_CONDITIONS = Object.freeze([
  'not_draft',
  'mergeable',
  'checks_passing',
  'approved',
  'at_least_one_label',
]);

const TERMINAL_SUCCESS_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

function parseConditions(input) {
  if (input === undefined || input === null) {
    return { conditions: [...ALL_CONDITIONS], unknown: [] };
  }
  const trimmed = String(input).trim();
  if (trimmed === '') {
    return { conditions: [...ALL_CONDITIONS], unknown: [] };
  }
  const known = new Set(ALL_CONDITIONS);
  const seen = new Set();
  const result = [];
  const unknown = [];
  for (const raw of trimmed.split(',')) {
    const name = raw.trim().toLowerCase();
    if (name === '') continue;
    if (!known.has(name)) {
      unknown.push(name);
      continue;
    }
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return { conditions: result, unknown };
}

async function evaluateReadyToMerge({
  github,
  context,
  pr,
  conditions,
  checkedLabelsCount,
  core,
}) {
  const enabled = new Set(conditions);
  const reasons = [];
  const { owner, repo } = context.repo;

  if (enabled.has('not_draft')) {
    if (pr.draft === true) reasons.push('PR is a draft');
  }

  if (enabled.has('mergeable')) {
    let mergeable = pr.mergeable;
    if (mergeable === null || mergeable === undefined) {
      try {
        const { data } = await github.rest.pulls.get({
          owner, repo, pull_number: pr.number,
        });
        mergeable = data.mergeable;
      } catch (err) {
        core.info(`Could not fetch PR for mergeable check: ${err.message}`);
      }
    }
    if (mergeable === false) {
      reasons.push('PR has merge conflicts');
    } else if (mergeable === null || mergeable === undefined) {
      reasons.push('PR mergeable state is unknown');
    }
  }

  if (enabled.has('checks_passing')) {
    const headSha = pr.head && pr.head.sha;
    if (!headSha) {
      reasons.push('PR head SHA unavailable');
    } else {
      const selfNames = new Set(
        [context.job, context.workflow].filter((n) => typeof n === 'string' && n.length > 0),
      );

      try {
        const { data: checkData } = await github.rest.checks.listForRef({
          owner, repo, ref: headSha, per_page: 100,
        });
        const runs = (checkData && checkData.check_runs) || [];
        const relevant = runs.filter((r) => !selfNames.has(r.name));
        const pending = relevant.filter((r) => r.status !== 'completed');
        const failed = relevant.filter(
          (r) => r.status === 'completed' && !TERMINAL_SUCCESS_CONCLUSIONS.has(r.conclusion),
        );
        if (pending.length > 0) reasons.push(`${pending.length} check run(s) still pending`);
        if (failed.length > 0) reasons.push(`${failed.length} check run(s) not passing`);
      } catch (err) {
        core.info(`Could not fetch check runs: ${err.message}`);
        reasons.push('Failed to fetch check runs');
      }

      try {
        const { data: status } = await github.rest.repos.getCombinedStatusForRef({
          owner, repo, ref: headSha,
        });
        if (status && status.total_count > 0 && status.state !== 'success') {
          reasons.push(`Combined status is ${status.state}`);
        }
      } catch (err) {
        core.info(`Could not fetch combined status: ${err.message}`);
      }
    }
  }

  if (enabled.has('approved')) {
    try {
      const { data: reviews } = await github.rest.pulls.listReviews({
        owner, repo, pull_number: pr.number, per_page: 100,
      });
      const latestByReviewer = new Map();
      for (const review of reviews || []) {
        if (!review || !review.user) continue;
        if (review.state === 'COMMENTED' || review.state === 'PENDING') continue;
        latestByReviewer.set(review.user.login, review.state);
      }
      const states = [...latestByReviewer.values()];
      const approvals = states.filter((s) => s === 'APPROVED').length;
      const changes = states.filter((s) => s === 'CHANGES_REQUESTED').length;
      if (approvals === 0) reasons.push('No approving reviews');
      if (changes > 0) reasons.push(`${changes} outstanding changes-requested review(s)`);
    } catch (err) {
      core.info(`Could not fetch reviews: ${err.message}`);
      reasons.push('Failed to fetch reviews');
    }
  }

  if (enabled.has('at_least_one_label')) {
    if (!(checkedLabelsCount > 0)) reasons.push('No known labels selected');
  }

  return { ready: reasons.length === 0, reasons };
}

module.exports = {
  ALL_CONDITIONS,
  parseConditions,
  evaluateReadyToMerge,
};
