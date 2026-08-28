async function resolvePullRequests({ github, context, core }) {
  const { owner, repo } = context.repo;
  const payload = (context && context.payload) || {};

  if (payload.pull_request) {
    return [payload.pull_request];
  }

  const embeddedRefs =
    (payload.check_suite && payload.check_suite.pull_requests) ||
    (payload.check_run && payload.check_run.pull_requests) ||
    [];

  const embeddedNumbers = embeddedRefs
    .map((p) => p && p.number)
    .filter((n) => typeof n === 'number');

  const embeddedFromSameRepo = embeddedRefs.filter(
    (p) =>
      p &&
      p.base &&
      p.base.repo &&
      p.base.repo.owner &&
      p.base.repo.owner.login === owner &&
      p.base.repo.name === repo,
  );
  const sameRepoNumbers = embeddedFromSameRepo
    .map((p) => p.number)
    .filter((n) => typeof n === 'number');

  let candidateNumbers = sameRepoNumbers.length > 0 ? sameRepoNumbers : embeddedNumbers;

  const headSha =
    (payload.check_suite && payload.check_suite.head_sha) ||
    (payload.check_run && payload.check_run.head_sha) ||
    payload.sha;

  if (candidateNumbers.length === 0 && headSha) {
    try {
      const { data: openPrs } = await github.rest.pulls.list({
        owner, repo, state: 'open', per_page: 100,
      });
      candidateNumbers = openPrs
        .filter((p) => p.head && p.head.sha === headSha)
        .map((p) => p.number);
    } catch (err) {
      core.info(`Could not list open PRs to resolve head SHA: ${err.message}`);
    }
  }

  if (candidateNumbers.length === 0) return [];

  const results = [];
  const seen = new Set();
  for (const n of candidateNumbers) {
    if (seen.has(n)) continue;
    seen.add(n);
    try {
      const { data } = await github.rest.pulls.get({
        owner, repo, pull_number: n,
      });
      results.push(data);
    } catch (err) {
      core.info(`Could not fetch PR #${n}: ${err.message}`);
    }
  }
  return results;
}

module.exports = { resolvePullRequests };
