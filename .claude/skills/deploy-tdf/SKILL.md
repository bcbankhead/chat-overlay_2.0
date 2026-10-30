---
name: deploy-tdf
description: Test, build and upload the TDF Chat site include and the forum sticky header include to S3 with `npm run deploy`, then verify both live objects. Run only when the user invokes /deploy-tdf.
disable-model-invocation: true
---

Deploy the two site includes — `tdf-chat.js` (the chat) and `tdf-forum-sticky-header.js` (the forum pages) — from this repo's main checkout and confirm each live copy is the one just built. Both carry the one `package.json` version and are uploaded together. `docs/site-include.md` documents the deploy path; this command runs it.

## 1. Preflight

Run in parallel:

- `git rev-parse --abbrev-ref HEAD` and `git status --porcelain`
- `git fetch origin main` then `git rev-list --left-right --count main...origin/main`
- `aws sts get-caller-identity --profile conduit --no-cli-pager --query Arn --output text`
- `node -p "require('./package.json').version"`
- `curl -s https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-chat.js | head -1`
- `curl -s https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-forum-sticky-header.js | head -1` (a first line that is not the forum banner means the forum file has never been deployed)

Then:

- **Not on `main`, a dirty tree, or `main` behind `origin/main`**: say which, and ask with `AskUserQuestion` whether to deploy anyway (`Deploy anyway` / `Stop`). A deploy from anywhere but an up-to-date, clean `main` ships code that is not on `main`.
- **The AWS call fails** (expired or missing SSO session): stop, and tell the user to run `! aws sso login --profile conduit`, then `/deploy-tdf` again. Do not run the login yourself; it opens a browser.
## 2. Version

The version is how a member's copy is identified, so two different builds under one version cannot be told apart. Skip this step when neither live first line names the local version: the local version is already new for both files.

When either live first line names the local `package.json` version, and the preflight was overridden with `Deploy anyway`, do not bump or commit: say the live file already carries this version, and ask with `AskUserQuestion` whether to deploy under it (`Deploy as is` / `Stop`). An automatic bump commit belongs only on a clean `main` that is level with `origin/main`.

Otherwise, run `npm test`, then `npm run build`. A non-zero exit from either means stop and report the failing tests or build error; nothing is bumped, so no commit is left for a version that never shipped. Then compare:

```bash
base=https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0
for f in tdf-chat.js tdf-forum-sticky-header.js; do
  live=$(mktemp)
  code=$(curl -s -o "$live" -w '%{http_code}' "$base/$f")
  if [ "$code" = 404 ] || [ "$code" = 403 ]; then echo "$f MISSING"
  elif [ "$code" != 200 ]; then echo "$f FETCH_FAILED ($code)"
  elif cmp -s "$live" "dist/$f"; then echo "$f IDENTICAL"
  else echo "$f DIFFERS"; fi
done
```

S3 answers `403` rather than `404` for a missing public object, so `MISSING` covers both.

- **Either `FETCH_FAILED`**: that live file could not be read, so the builds cannot be compared. Report the failure and stop; nothing is bumped.
- **Both `IDENTICAL`**: the live files are already this build. Say so and stop; there is nothing to deploy.
- **Either `DIFFERS` or `MISSING`** (including a change to the forum include alone): bump the patch version without asking — `npm version patch --no-git-tag-version`, which updates `package.json` and `package-lock.json` — then `git add package.json package-lock.json` and commit on `main` with the subject `Bump the version to <new version> for the site include deploy`, the body naming the commits since the last bump (`git log --oneline <last bump commit>..HEAD`). Do not push; report that `main` is ahead of `origin/main`.

## 3. Deploy

Run `npm run deploy` with a 5-minute timeout. It runs the tests, then the build, and uploads only if both pass. A non-zero exit from the tests or the build means nothing was uploaded: report the failing tests or build error and stop. It uploads `tdf-forum-sticky-header.js` first and `tdf-chat.js` last, so a failed upload leaves the live `tdf-chat.js` version unchanged and the deploy can simply be re-run.

## 4. Verify

```bash
for f in tdf-chat.js tdf-forum-sticky-header.js; do
  u=https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/$f
  echo "== $f"
  curl -sI "$u" | grep -iE '^(HTTP|content-type|cache-control|last-modified)'
  curl -s "$u" | head -1
  cmp <(curl -s "$u") "dist/$f" && echo IDENTICAL
done
```

Expect, for each file, `200`, `Content-Type: text/javascript`, `Cache-Control: max-age=300`, a first line naming the local version, and `IDENTICAL`. Any mismatch on either file is a failed deploy: report it.

## 5. Report

Keep it short: tests passed (count), the version deployed (and the bump commit, if step 2 made one), the header check and the byte-for-byte match for each file. Mention that members who already had the previous files can keep them for up to 5 minutes.
