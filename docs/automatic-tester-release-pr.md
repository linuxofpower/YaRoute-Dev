# Automatic reviewed tester -> protected master PRs

This is a connector capability, not permission to merge, bypass protections or deploy.

## New MCP tool

`nyx_connection_github_tester_release_pr` with:
- `id`: authenticated owner's GitHub connection ID in NestNyx.
- `repo`: explicit owner/repo (a connected and authorized GitHub App installation).
- `expectedTesterSha`: exact previously inspected 40-character tester commit SHA.
- `title` and optional `body` (review-only release description).

Only `tester` may be promoted by this tool. The GitHub repository must have
a protected default branch named `master` or `main`; no other destination
is accepted. An exact current tester SHA is required, along with a clean
ahead-only GitHub comparison and 1-100 changed files.

GitHub scopes required on that repository: app installation Contents: read
(for branch/compare metadata), Pull requests: read/write; the Nest owner
connection must authorize `resources:read`, `pulls:read`, and
`pulls:write`. The API obtains bounded installation tokens at invocation
time. Do not store user PATs or reuse local `gh auth` credentials in Nest.

The tool reads any existing open PR from tester to the default branch and
returns that PR instead of opening a duplicate. If the PR inventory is too
large to check reliably it fails closed. If the tester tip, base protection
or comparison does not match, no PR is created.

The only authorized write is GitHub POST /pulls with `draft:true` and
`maintainer_can_modify:false`. There is no merge, deployment, branch
update, workflow dispatch or GitHub protection-bypass capability.

## Release prerequisites

1. Review PR #32, merge it through existing GitHub protected-main policy,
   deploy the reviewed code to the intended Nest runtime and refresh its MCP
   tool list.
2. Confirm the owner's GitHub App connection grants `pulls:write`,
   `pulls:read` and `resources:read` for the production repository, and
   that the GitHub App installation has permitted Pull requests write and
   Contents read permissions.
3. Call the new tool with the current exact `tester` SHA and a review title.
4. Human owner reviews and accepts the PR; GitHub protections remain enforced
   for merge. Production deploy is a separate action.

No automatic scheduled PR creation, auto-merge or auto-deploy is enabled.
The existing GitHub/ChatGPT integration may still fail with 403 if the app
installation token has insufficient provider privileges. This tool uses
Nest's own GitHub App installation, not the `gh` CLI or a personal token.
