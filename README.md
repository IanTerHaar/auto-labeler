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

jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - uses: IanTerHaar/auto-labeler@v<latest_version>
        with:
          labels: bug, chore, dependencies, documentation, feature, security
          # Optional: fail the workflow when no known label checkbox is selected
          fail_on_no_label: true
```

Replace `<latest_version>` with the [latest release tag](https://github.com/IanTerHaar/auto-labeler/releases).

## Inputs

| Name               | Required | Default               | Description                                                                                                         |
| ------------------ | -------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `labels`           | yes      | —                     | Comma-separated list of known labels the action is allowed to add or remove.                                        |
| `token`            | no       | `${{ github.token }}` | Token used to read and update PR labels.                                                                            |
| `fail_on_no_label` | no       | `false`               | If set to `true`, the action fails the workflow when no known label checkboxes are selected in the PR description.  |

## PR body format

The action scans the PR body for markdown task-list lines whose text matches one of the known labels (case-insensitive):

```markdown
- [x] bug
- [ ] chore
- [x] feature
```

Only labels listed in the `labels` input are managed; any other checkboxes are ignored.
