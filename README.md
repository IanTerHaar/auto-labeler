# auto-labeler

A GitHub Action that applies labels to a pull request based on checked checkboxes in the PR body.

[![GitHub release](https://img.shields.io/github/v/release/IanTerHaar/auto-labeler?sort=semver)](https://github.com/IanTerHaar/auto-labeler/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Usage

```yaml
name: Autolabeler

on:
  pull_request_target:
    types: [opened, edited, reopened, synchronize]

permissions:
  pull-requests: write
  contents: read
  checks: read
  statuses: read

jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - uses: IanTerHaar/auto-labeler@v<latest_version>
        with:
          labels: bug, chore, dependencies, documentation, feature, security
          # Optional: fail the workflow when no known label checkbox is selected
          fail_on_no_label: true
          # Optional: label applied when the PR meets all conditions below
          # (set to an empty string to disable the ready-to-merge feature)
          ready_to_merge_label: Ready to Merge
          # Optional: which conditions must be satisfied to apply the label
          ready_to_merge_conditions: not_draft, mergeable, checks_passing, approved, at_least_one_label
```

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

### Required permissions

Reading checks, statuses, and reviews requires the workflow to grant a bit more than the default label-write permissions:

```yaml
permissions:
  pull-requests: write
  contents: read
  checks: read
  statuses: read
```
