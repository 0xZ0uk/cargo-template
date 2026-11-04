# Pullfrog

[Pullfrog](https://docs.pullfrog.com) reviews this repo's pull requests with **DeepSeek V4.1 Flash on the OpenCode Go plan**. It re-reviews each push, answers `@pullfrog` mentions, and fixes CI failures on its own PRs.

| File | What it is |
|---|---|
| `../workflows/pullfrog.yml` | The workflow Pullfrog dispatches: model, key, timeout, push policy, toolchain |
| `review.md` | Review instructions (console: **Automations → Review PRs → Custom instructions**) |
| `fix-ci.md` | CI-fix instructions (console: **Automations → Fix CI failures → Custom instructions**) |

The console stores the instructions, not this repo. After editing a file, push it with the `pullfrog config set` commands below.

## How it fits together

- Pullfrog runs the workflow with `workflow_dispatch` against **the copy on `master`**, so a PR can't change the workflow (or the key mapping) that reviews it. Workflow changes take effect after merge.
- Its runs never show in a PR's checks list. Two checks report on the PR instead: `pullfrog` (run status, on by default) and `pullfrog-approval` (would it approve?, off by default). Neither blocks a merge until branch protection requires it.
- Model resolution: the repository model in the console wins over the workflow's `model:`. Keep the repository model unset ("Custom (set in workflow)"), so `opencode-go/deepseek-v4.1-flash` from the workflow applies. A per-run `--model` flag in a mention still overrides it.
- Effort isn't set in the workflow. The console's value applies (default `0.5`, DeepSeek's middle setting). Override per run with `--effort high`.
- The agent runs on OpenCode, not Claude Code, so it reads `AGENTS.md` like any other agent here.

## One-time setup

1. **OpenCode.** On an OpenCode Go subscription, open the workspace settings and turn on the **DeepSeek opt-in** (China hosting). DeepSeek isn't on the Go menu otherwise, and runs fail with a link to that setting. Then create an API key.
2. **Pullfrog app.** Sign in at <https://pullfrog.com/console> with GitHub. Install the GitHub App on `0xZ0uk` for this repository only, and pick **BYOK** billing (not Pullfrog Router), so runs spend your OpenCode Go quota and not a prepaid Router balance.
3. **Key, stored with Pullfrog:** console → **Billing** → **Providers** → **BYOK** → **OpenCode** → **Set up**, or:

   ```sh
   npx pullfrog@latest secret set OPENCODE_API_KEY --org 0xZ0uk
   npx pullfrog@latest secret list --repo 0xZ0uk/cargo-template   # shows it as [org, inherited]
   ```

   Don't also add it as a GitHub Actions secret mapped in the workflow. A workflow value beats the stored key, and Pullfrog's server can't see it when it picks the model: on a repo with `oss` funding on, a key that only lives in GitHub makes the run fall back to Pullfrog's funded default instead of `opencode-go/deepseek-v4.1-flash`.
4. **Merge the workflow to `master`**, then click **Verify manual installation** on the repository's console page.
5. **Console settings.** The CLI writes the same settings as the console and acts as your `gh` login (scopes `repo` and `read:org`):

   ```sh
   R=0xZ0uk/cargo-template
   npx pullfrog@latest config unset model --repo $R          # model comes from the workflow
   npx pullfrog@latest config set review.mode agent --repo $R
   npx pullfrog@latest config set review.re-review true --repo $R
   npx pullfrog@latest config set review.drafts false --repo $R
   # Public repo: reviews of outsiders' PRs would spend the Go quota on anyone's PR.
   # The default is on; turn it back on per PR with an @pullfrog mention.
   npx pullfrog@latest config set review.non-collaborators false --repo $R
   npx pullfrog@latest config set push restricted --repo $R  # the workflow sets it too
   npx pullfrog@latest config set prompts.review --file .github/pullfrog/review.md --repo $R
   npx pullfrog@latest config set prompts.fix-ci --file .github/pullfrog/fix-ci.md --repo $R
   npx pullfrog@latest config list --repo $R                 # check where each value comes from
   ```

   Leave **Allow Pullfrog to approve PRs** (`review.approve`), auto-merge and the `pullfrog-approval` check off until the reviews have earned trust.
6. **Try it.** Comment `@pullfrog review this PR` on an open PR, or send a prompt from the console. In the job log, look for `"opencode-go/deepseek-v4.1-flash" is not a curated alias — passing through as a raw model specifier`, which shows the workflow's model was used.

## Limits and costs

- OpenCode Go is a flat monthly fee with capped usage. When the cap is hit, runs fail until it resets, because no fallback key is configured. Add a second provider key to fall back to; that one bills per token.
- Each run uses Actions minutes: about a minute of setup (`pnpm install`) plus the agent. The workflow caps a run at 30 minutes (`timeout:`), and the job at 45.
- Prompts carry repository code to OpenCode's DeepSeek hosting, which is in China (that's what the opt-in is for).

## Security notes

- Pullfrog injects `OPENCODE_API_KEY` into the agent process only. Pullfrog's shell isolation (on by default; always on for public repos) drops `*_KEY` variables from the commands the agent runs.
- `push: restricted` lets the agent push to feature branches only: never to `master`, no branch deletion, no tags. Runs triggered by non-collaborators get a read-only token anyway.
- Actions are pinned to commit SHAs; Dependabot (`../dependabot.yml`) bumps them weekly.
