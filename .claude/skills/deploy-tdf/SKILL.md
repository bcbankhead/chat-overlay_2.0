---
name: deploy-tdf
description: Test, build and upload the TDF Chat site include and the forum sticky header include to S3 with `npm run deploy`, then verify both live objects. Run only when the user invokes /deploy-tdf.
disable-model-invocation: true
---

Deploy the two site includes — `tdf-chat.js` (the chat) and `tdf-forum-sticky-header.js` (the forum pages) — from this repo's main checkout and confirm each live copy is the one just built. Each carries its own version — the chat `package.json`'s, the forum include `src/forum/version.json`'s — and only the one whose build changed is bumped; both are uploaded together. `docs/site-include.md` documents the deploy path; this command runs it.

## 1. Preflight

Run in parallel:

- `git rev-parse --abbrev-ref HEAD` and `git status --porcelain`
- `git fetch origin main` then `git rev-list --left-right --count main...origin/main`
- `aws sts get-caller-identity --profile conduit --no-cli-pager --query Arn --output text`
- `node -p "require('./package.json').version"` (the chat's local version) and `node -p "require('./src/forum/version.json').version"` (the forum include's)
- `curl -s https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-chat.js | head -1`
- `curl -s https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-forum-sticky-header.js | head -1` (a first line that is not the forum banner means the forum file has never been deployed)

Then:

- **Not on `main`, a dirty tree, or `main` behind `origin/main`**: say which, and ask with `AskUserQuestion` whether to deploy anyway (`Deploy anyway` / `Stop`). A deploy from anywhere but an up-to-date, clean `main` ships code that is not on `main`.
- **The AWS call fails** (expired or missing SSO session): stop, and tell the user to run `! aws sso login --profile conduit`, then `/deploy-tdf` again. Do not run the login yourself; it opens a browser.
## 2. Version

The version is how a member's copy is identified, so two different builds under one version cannot be told apart. The two files are versioned independently, so every rule below is applied to each file against its own local version: `tdf-chat.js` against `package.json`'s, `tdf-forum-sticky-header.js` against `src/forum/version.json`'s. A file whose live first line does not name its local version needs no bump: its local version is already new. Skip this step when that holds for both files.

When a live first line names its file's local version, and the preflight was overridden with `Deploy anyway`, do not bump or commit: say which live file already carries its version, and ask with `AskUserQuestion` whether to deploy under it (`Deploy as is` / `Stop`). An automatic bump commit belongs only on a clean `main` that is level with `origin/main`.

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
- **Otherwise**, for each file that is `DIFFERS` and whose live first line names its local version, bump that file's patch version without asking — and only that file's. An `IDENTICAL` file keeps its version, so its live banner stays true. A `MISSING` file, or one whose live first line names an older version, needs no bump.
  - `tdf-chat.js`: `npm version patch --no-git-tag-version`, which updates `package.json` and `package-lock.json`; stage both.
  - `tdf-forum-sticky-header.js`: `node -e "const fs=require('fs'),f='src/forum/version.json',j=JSON.parse(fs.readFileSync(f,'utf8')),v=j.version.split('.').map(Number);v[2]++;j.version=v.join('.');fs.writeFileSync(f,JSON.stringify(j,null,2)+String.fromCharCode(10));console.log(j.version)"`; stage `src/forum/version.json`.

  When nothing needed a bump, go to step 3. Otherwise make one commit on `main`, its subject naming what was bumped — `Bump the chat version to <v> for the site include deploy`, `Bump the forum include version to <v> for the site include deploy`, or `Bump the chat version to <v> and the forum include version to <v> for the site include deploy` — the body naming the commits since the last bump (`git log --oneline <last bump commit>..HEAD`, the last bump commit being the latest whose subject starts `Bump the`). Do not push; report that `main` is ahead of `origin/main`.

## 3. Deploy

Run `npm run deploy` with a 5-minute timeout. It runs the tests, then the build, and uploads only if both pass. A non-zero exit from the tests or the build means nothing was uploaded: report the failing tests or build error and stop. It uploads `tdf-forum-sticky-header.js` first and `tdf-chat.js` last. Each upload replaces one whole object, so a failed upload leaves that file's live version — its own first line — unchanged, and the deploy can simply be re-run.

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

Expect, for each file, `200`, `Content-Type: text/javascript`, `Cache-Control: max-age=300`, a first line naming that file's own local version (`package.json`'s for `tdf-chat.js`, `src/forum/version.json`'s for the forum include), and `IDENTICAL`. Any mismatch on either file is a failed deploy: report it.

## 5. Report

Keep it short: tests passed (count), each file's version, saying which were bumped (and the bump commit, if step 2 made one), the header check and the byte-for-byte match for each file. Mention that members who already had the previous files can keep them for up to 5 minutes.
