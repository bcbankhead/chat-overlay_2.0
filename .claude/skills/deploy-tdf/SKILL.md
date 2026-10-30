---
name: deploy-tdf
description: Test, build and upload the TDF Chat site include to S3 with `npm run deploy`, then verify the live object. Run only when the user invokes /deploy-tdf.
disable-model-invocation: true
---

Deploy the site include from this repo's main checkout and confirm the live copy is the one just built. `docs/site-include.md` documents the deploy path; this command runs it.

## 1. Preflight

Run in parallel:

- `git rev-parse --abbrev-ref HEAD` and `git status --porcelain`
- `git fetch origin main` then `git rev-list --left-right --count main...origin/main`
- `aws sts get-caller-identity --profile conduit --no-cli-pager --query Arn --output text`
- `node -p "require('./package.json').version"`
- `curl -s https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-chat.js | head -1`

Then:

- **Not on `main`, a dirty tree, or `main` behind `origin/main`**: say which, and ask with `AskUserQuestion` whether to deploy anyway (`Deploy anyway` / `Stop`). A deploy from anywhere but an up-to-date, clean `main` ships code that is not on `main`.
- **The AWS call fails** (expired or missing SSO session): stop, and tell the user to run `! aws sso login --profile conduit`, then `/deploy-tdf` again. Do not run the login yourself; it opens a browser.
## 2. Version

The version is how a member's copy is identified, so two different builds under one version cannot be told apart. Skip this step when the live first line names a version other than the local one: the local version is already new.

When the live first line names the local `package.json` version, and the preflight was overridden with `Deploy anyway`, do not bump or commit: say the live file already carries this version, and ask with `AskUserQuestion` whether to deploy under it (`Deploy as is` / `Stop`). An automatic bump commit belongs only on a clean `main` that is level with `origin/main`.

Otherwise, run `npm test`, then `npm run build`. A non-zero exit from either means stop and report the failing tests or build error; nothing is bumped, so no commit is left for a version that never shipped. Then compare:

```bash
live=$(mktemp)
if ! curl -sf -o "$live" https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-chat.js; then echo FETCH_FAILED
elif cmp -s "$live" dist/tdf-chat.js; then echo IDENTICAL
else echo DIFFERS; fi
```

- **`FETCH_FAILED`**: the live file could not be read, so the builds cannot be compared. Report the failure and stop; nothing is bumped.
- **`IDENTICAL`**: the live file is already this build. Say so and stop; there is nothing to deploy.
- **`DIFFERS`**: bump the patch version without asking — `npm version patch --no-git-tag-version`, which updates `package.json` and `package-lock.json` — then `git add package.json package-lock.json` and commit on `main` with the subject `Bump the version to <new version> for the site include deploy`, the body naming the commits since the last bump (`git log --oneline <last bump commit>..HEAD`). Do not push; report that `main` is ahead of `origin/main`.

## 3. Deploy

Run `npm run deploy` with a 5-minute timeout. It runs the tests, then the build, and uploads only if both pass. A non-zero exit means nothing was uploaded: report the failing tests or build error and stop.

## 4. Verify

```bash
u=https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-chat.js
curl -sI "$u" | grep -iE '^(HTTP|content-type|cache-control|last-modified)'
curl -s "$u" | head -1
cmp <(curl -s "$u") dist/tdf-chat.js && echo IDENTICAL
```

Expect `200`, `Content-Type: text/javascript`, `Cache-Control: max-age=300`, a first line naming the local version, and `IDENTICAL`. Any mismatch is a failed deploy: report it.

## 5. Report

Keep it short: tests passed (count), the version deployed (and the bump commit, if step 2 made one), the header check, and the byte-for-byte match. Mention that members who already had the previous file can keep it for up to 5 minutes.
