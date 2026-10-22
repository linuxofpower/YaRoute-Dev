#!/usr/bin/env bash
# NYX: promote reviewed, CI-verified development code into the staging mirror.
# Deliberately never updates main/master, force-pushes, or deploys Heroku.
set -euo pipefail

MODE="${1:---plan}"
[[ "$MODE" == "--plan" || "$MODE" == "--apply" ]] || {
  echo "Usage: $0 [--plan|--apply]" >&2; exit 2;
}
for tool in git gh jq mktemp; do
  command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 2; }
done

SOURCE="linux""ofpower/YaRoute-Dev"
DEST="yaMorozYaroslav/YaRoute"
SOURCE_REF="main"
STAGING_REF="tester"

# Explicitly permitted staging-only differences. Every other tracked file,
# including application source and tests, must match the reviewed source tree.
STAGING_ONLY=(
  ".github/CODEOWNERS"
  ".github/workflows/ci.yml"
  ".github/workflows/security-audit.yml"
  "README.md"
  "app.json"
  ".nyx/staging-source.json"
)
excluded=()
for path in "${STAGING_ONLY[@]}"; do excluded+=(":(exclude)$path"); done

actor="$(gh api user --jq .login)"
if [[ "$actor" != "yaMorozYaroslav" ]]; then
  echo "Select yaMorozYaroslav: gh auth switch -h github.com -u yaMorozYaroslav" >&2
  exit 2
fi

source_sha="$(gh api "repos/$SOURCE/branches/$SOURCE_REF" --jq .commit.sha)"
stage_sha="$(gh api "repos/$DEST/branches/$STAGING_REF" --jq .commit.sha)"
master_before="$(gh api "repos/$DEST/branches/master" --jq .commit.sha)"
[[ "$source_sha" =~ ^[a-f0-9]{40}$ && "$stage_sha" =~ ^[a-f0-9]{40}$ ]] || exit 2
echo "Source: $SOURCE:$SOURCE_REF @ $source_sha"
echo "Staging: $DEST:$STAGING_REF @ $stage_sha"

# The branch-contract PR must be reviewed and merged into the source, not
# promoted by cherry-picking unmerged feature branches.
merged_at="$(gh pr view 26 -R "$SOURCE" --json mergedAt --jq '.mergedAt // ""')"
[[ -n "$merged_at" ]] || { echo "STOP: review and merge $SOURCE PR #26 first." >&2; exit 3; }

# Fail closed unless BOTH workflows have succeeded on the exact source commit.
runs="$(gh run list -R "$SOURCE" -b "$SOURCE_REF" -L 75 --json headSha,name,status,conclusion,event)"
echo "$runs" | jq -e --arg sha "$source_sha" '
  any(.[]; .headSha==$sha and .name=="CI" and .status=="completed" and .conclusion=="success")
  and any(.[]; .headSha==$sha and .name=="Public repository security audit"
      and .status=="completed" and .conclusion=="success")
' >/dev/null || {
  echo "STOP: missing successful CI and security audit on exact source SHA." >&2; exit 3;
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone --quiet --single-branch --branch "$STAGING_REF" "https://github.com/$DEST.git" "$tmp/mirror"
cd "$tmp/mirror"
[[ "$(git rev-parse HEAD)" == "$stage_sha" ]] || {
  echo "STOP: staging moved during checkout." >&2; exit 4;
}
git remote add source "https://github.com/$SOURCE.git"
git fetch --quiet source "$SOURCE_REF"
[[ "$(git rev-parse FETCH_HEAD)" == "$source_sha" ]] || {
  echo "STOP: source changed during fetch; run again." >&2; exit 4;
}
git branch -f source-reviewed "$source_sha"

# Reconcile all code, tests, assets and docs except explicit staging-only
# paths; 'git restore' handles additions, modifications, and deletions.
git restore --source=source-reviewed --staged --worktree -- . "${excluded[@]}"
if ! git diff --cached --quiet source-reviewed -- . "${excluded[@]}"; then
  echo "STOP: staged index does not match reviewed source code." >&2; exit 4;
fi
git diff --cached --check

echo "Proposed changes (staging-only files excluded):"
git diff --cached --name-status
echo "Preserved staging-only files: ${STAGING_ONLY[*]}"

if [[ "$MODE" == "--plan" ]]; then
  echo "PLAN ONLY: no GitHub writes. Run with --apply after reviewing.";
  exit 0
fi

# Never write a promotion if staging moved after the plan.
current_stage="$(gh api "repos/$DEST/branches/$STAGING_REF" --jq .commit.sha)"
[[ "$current_stage" == "$stage_sha" ]] || {
  echo "STOP: tester moved since checkout." >&2; exit 4;
}
current_source="$(gh api "repos/$SOURCE/branches/$SOURCE_REF" --jq .commit.sha)"
[[ "$current_source" == "$source_sha" ]] || {
  echo "STOP: development main moved since CI verification." >&2; exit 4;
}

mkdir -p .nyx
jq -n --arg source "$SOURCE" --arg sha "$source_sha"   --arg branch "$SOURCE_REF" --arg target "$STAGING_REF"   --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)"   '{schema:1, sourceRepo:$source, sourceBranch:$branch, sourceSha:$sha,
    targetBranch:$target, promotedAt:$date,
    stagedOverrides:[".github/CODEOWNERS",".github/workflows/ci.yml",
      ".github/workflows/security-audit.yml","README.md","app.json",
      ".nyx/staging-source.json"]}' > .nyx/staging-source.json
git add .nyx/staging-source.json
git diff --cached --check

if git diff --cached --quiet; then
  echo "Already synchronized. Nothing to push."
else
  git -c user.name="NYX Staging Promoter"       -c user.email="nyx-staging@users.noreply.github.com"     commit -m "Promote verified YaRoute-Dev main $source_sha to tester"            -m "NYX-Source-Repo: $SOURCE"            -m "NYX-Source-SHA: $source_sha"
  # Non-force push rejects concurrent changes. Never update master.
  git push origin HEAD:refs/heads/tester
fi

master_after="$(gh api "repos/$DEST/branches/master" --jq .commit.sha)"
[[ "$master_after" == "$master_before" ]] || {
  echo "ALERT: master changed independently during promotion; inspect separately." >&2
  exit 5
}
echo "Promotion pushed to tester. Check tester CI; do NOT deploy on failure."
echo "Source SHA: $source_sha"
echo "Staging: https://github.com/$DEST/tree/tester"
