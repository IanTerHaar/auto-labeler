# auto-labeler

A GitHub Action that applies labels to a pull request based on checked checkboxes in the PR body.

[![GitHub release](https://img.shields.io/github/v/release/IanTerHaar/auto-labeler?sort=semver)](https://github.com/IanTerHaar/auto-labeler/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Usage

Which events you subscribe to determine _when_ the labels are re-evaluated. There are two levels of configuration:

1. **Minimum** — enough for the checkbox → label behavior alone.
2. **Ready-to-merge** — extra triggers layered on top so the `Ready to Merge` label reacts to reviews, CI, and draft toggles.

### Minimum triggers (ready-to-merge feature disabled)

This is all you need if you only want the checkbox → label behavior. Disable the ready-to-merge feature by setting `ready_to_merge_label` to an empty string.

```yaml
name: Autolabeler

on:
  pull_request_target:
    types: [opened, edited, reopened, synchronize]

permissions:
  pull-requests: write
  contents: read

jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - uses: IanTerHaar/auto-labeler@v<latest_version>
        with:
          labels: bug, chore, dependencies, documentation, feature, security
          fail_on_no_label: true
          ready_to_merge_label: ''   # disable ready-to-merge
```

What this covers:

- `opened`, `reopened` — new PRs get labeled.
- `edited` — checkbox toggles in the PR body re-run the labeler.
- `synchronize` — new commits re-run the labeler.

### Adding the ready-to-merge feature

The `Ready to Merge` label can only be applied or removed when the workflow runs. Each condition you enable in `ready_to_merge_conditions` reacts to a different kind of change, so you need to subscribe to the corresponding events **on top of the minimum above**. Otherwise the label may lag until the next push or PR edit.

Add only what you need — the table shows exactly which events and permissions each condition requires beyond the minimum.

| Condition            | Extra `on:` events                                                                          | Extra `permissions:`                |
| -------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------- |
| `not_draft`          | `pull_request_target` types `ready_for_review`, `converted_to_draft`                        | _(none)_                            |
| `mergeable`          | _(covered by `synchronize` in the minimum)_                                                 | _(none)_                            |
| `checks_passing`     | `check_suite: [completed]` and, if you use commit statuses, `status:`                       | `checks: read`, `statuses: read`    |
| `approved`           | `pull_request_review: [submitted, edited, dismissed]`                                       | _(none)_                            |
| `at_least_one_label` | _(covered by `edited` in the minimum)_                                                      | _(none)_                            |

### Full example (all ready-to-merge conditions)

This layers every extra trigger and permission on top of the minimum, giving you the full ready-to-merge behavior.

```yaml
name: Autolabeler

on:
  # Minimum
  pull_request_target:
    types:
      - opened
      - edited
      - reopened
      - synchronize
      # for `not_draft`
      - ready_for_review
      - converted_to_draft
  # for `approved`
  pull_request_review:
    types: [submitted, edited, dismissed]
  # for `checks_passing`
  check_suite:
    types: [completed]
  status:

permissions:
  # Minimum
  pull-requests: write
  contents: read
  # for `checks_passing`
  checks: read
  statuses: read

jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - uses: IanTerHaar/auto-labeler@v<latest_version>
        with:
          labels: bug, chore, dependencies, documentation, feature, security
          fail_on_no_label: true
          ready_to_merge_label: Ready to Merge
          ready_to_merge_conditions: not_draft, mergeable, checks_passing, approved, at_least_one_label
```

### Partial examples

**Only `approved` (rely on branch protection for CI):**

```yaml
on:
  pull_request_target:
    types: [opened, edited, reopened, synchronize]
  # for `approved`
  pull_request_review:
    types: [submitted, edited, dismissed]

permissions:
  pull-requests: write
  contents: read

# ...
with:
  labels: bug, chore, feature
  ready_to_merge_conditions: not_draft, mergeable, approved, at_least_one_label
```

**Only `checks_passing` (no approval gating):**

```yaml
on:
  pull_request_target:
    types: [opened, edited, reopened, synchronize, ready_for_review, converted_to_draft]
  # for `checks_passing`
  check_suite:
    types: [completed]
  status:

permissions:
  pull-requests: write
  contents: read
  checks: read
  statuses: read

# ...
with:
  labels: bug, chore, feature
  ready_to_merge_conditions: not_draft, mergeable, checks_passing, at_least_one_label
```

### Notes

- On `check_suite`, `check_run`, and `status` events GitHub's payload doesn't include the PR object directly. The action resolves the PR from the event's head SHA — this works for both same-repo and fork PRs (open PRs only).
- If you don't enable `checks_passing`, you don't need the `check_suite` / `status` triggers or the `checks: read` / `statuses: read` permissions.
- If you don't enable `approved`, you don't need the `pull_request_review` trigger.

Replace `<latest_version>` with the [latest release tag](https://github.com/IanTerHaar/auto-labeler/releases).

## Inputs

| Name                        | Required | Default                                                                    | Description                                                                                                         |
| --------------------------- | -------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `labels`                    | yes      | —                                                                          | Comma-separated list of known labels the action is allowed to add or remove.                                        |
| `token`                     | no       | `${{ github.token }}`                                                      | Token used to read and update PR labels.                                                                            |
| `fail_on_no_label`          | no       | `false`                                                                    | If set to `true`, the action fails the workflow when no known label checkboxes are selected in the PR description.  |
| `ready_to_merge_label`      | no       | `Ready to Merge`                                                           | Label applied when the PR meets every configured condition. Set to an empty string to disable the feature.          |
| `ready_to_merge_conditions` | no       | `not_draft, mergeable, checks_passing, approved, at_least_one_label`       | Comma-separated conditions the PR must satisfy for the ready-to-merge label to be applied.                          |

## PR body format

The action scans the PR body for markdown task-list lines whose text matches one of the known labels (case-insensitive):

```markdown
- [x] bug
- [ ] chore
- [x] feature
```

Only labels listed in the `labels` input are managed; any other checkboxes are ignored.

## Ready-to-merge label

When enabled (default), the action can also apply a `Ready to Merge` label whenever the PR satisfies every configured condition. If any condition stops being met on a later run (e.g. a check fails, a review requests changes, a merge conflict appears), the label is removed automatically.

Supported conditions (all enabled by default):

| Condition            | Meaning                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `not_draft`          | The PR is not in draft state.                                                                      |
| `mergeable`          | GitHub reports the PR as mergeable (no conflicts). Unknown states count as not ready.              |
| `checks_passing`     | All check runs on the head SHA are completed with a `success`/`neutral`/`skipped` conclusion, and the combined commit status is `success` (or there are no statuses). The auto-labeler's own job is excluded so it doesn't block itself. |
| `approved`           | At least one review is `APPROVED`, with no outstanding `CHANGES_REQUESTED` review.                 |
| `at_least_one_label` | At least one known label checkbox is checked in the PR body.                                       |

Set `ready_to_merge_conditions` to a comma-separated subset to opt into only some checks (for example, `not_draft, mergeable, checks_passing` if your branch protection already enforces approvals). Set `ready_to_merge_label` to an empty string to disable the feature entirely.

See [Adding the ready-to-merge feature](#adding-the-ready-to-merge-feature) for which triggers and permissions each condition needs on top of the minimum setup.
