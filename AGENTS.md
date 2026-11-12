# Repository instructions

## Commits and pull request titles

- Use Conventional Commits for every commit message and pull request title
- Format: `type(optional-scope): short description`
- Use English and start the description with a lowercase letter
- Use an appropriate type such as `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, or `revert`
- Use `!` or a `BREAKING CHANGE:` footer for breaking changes
- Put issue references in the body or footer instead of prefixing the title with a ticket ID
- Preserve compliant manual edits made by the user

## Pull request descriptions

- Write every pull request description in English, including updates to open, closed, and merged pull requests
- Use concise bullets describing concrete changes or important verification results
- Explain the reason for a change when it helps a reviewer
- Avoid introductions, process narration, boilerplate, unnecessary implementation details, final periods, semicolons, and em dashes
- Read the current description before updating it and preserve the user's manual edits
- If the user asks to restore a description, restore their exact revision from edit history

## Code comments

- Start comments with a lowercase letter
- Do not end comments with a period or use semicolons
- Enclose identifiers and values mentioned in comment text in square brackets
- Preserve identifier casing and syntax required by directives and code examples

## Verification and review

- Run checks appropriate to the change
- Use `npm test` for unit tests and `python3 tests/firefox-ui-smoke.py` for Firefox UI regression checks
- For UI changes, inspect screenshots for alignment, spacing, matching fonts, light and dark themes, clipping, and working scroll areas
- Use Gravity UI UIKit and Gravity icons, preserving the console's native appearance
- Always obtain a separate final code review from a sub-agent using `gpt-6.1-sol` with `medium` reasoning effort, address actionable findings, and verify the final result before reporting completion
- For development delegation, use `gpt-6.1-sol` with `low` effort for code, `gpt-6.1-terra` with `low` effort for straightforward UI and documentation work, and `gpt-6-luna` with `medium` effort for searches and predefined checks

## Privacy and releases

- Never commit secrets, credentials, private console hosts, real cloud or account IDs, or personal data in code, tests, documentation, screenshots, or release archives
- Keep additional console addresses in local browser settings; the only default console address is `https://console.yandex.cloud`
- Use synthetic data for tests and documentation screenshots
- Check the source and artifacts for private data before pushing or publishing
- Create or publish a release only when the user explicitly requests it
- Do not describe an unsigned package as signed or an AMO submission as publicly available before Mozilla approves it
