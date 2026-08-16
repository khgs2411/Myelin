# Contributing

Thanks for your interest in improving Myelin.

This project is public and open source, but `master` is protected. Changes should come through issues and pull requests.

## Before You Start

- Open an issue for substantial changes before writing code.
- Keep pull requests focused on one problem.
- Preserve the existing local-first design and provenance model.
- Avoid broad rewrites unless a maintainer has agreed to the direction.

## Development Flow

1. Fork or branch from the current `master`.
2. Make the smallest coherent change.
3. Run the relevant checks.
4. Open a pull request with a short explanation of the problem and solution.

Common checks:

```bash
.venv/bin/pytest tests/ -q
```

Some sample-project tests may fail in working trees that do not include the optional `projects/sample/` fixture. Call that out in the pull request if it happens.

## Pull Request Expectations

- Explain what changed and why.
- Link related issues when available.
- Include test results or a clear note explaining why tests were not run.
- Do not mix unrelated formatting, refactors, or generated output with functional changes.

## Licensing

By contributing, you agree that your contribution is submitted under the Apache License 2.0 used by this repository.
