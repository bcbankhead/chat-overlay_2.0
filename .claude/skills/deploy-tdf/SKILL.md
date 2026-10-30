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
- **The live first line already names the local `package.json` version**: say so, and ask whether to bump the version before deploying (`Deploy as is` / `Stop`). The version is how a member's copy is identified, so two different builds under one version cannot be told apart.

## 2. Deploy

Run `npm run deploy` with a 5-minute timeout. It runs the tests, then the build, and uploads only if both pass. A non-zero exit means nothing was uploaded: report the failing tests or build error and stop.

## 3. Verify

```bash
u=https://sb76images.s3.us-west-2.amazonaws.com/tdf_chat_2.0/tdf-chat.js
curl -sI "$u" | grep -iE '^(HTTP|content-type|cache-control|last-modified)'
curl -s "$u" | head -1
cmp <(curl -s "$u") dist/tdf-chat.js && echo IDENTICAL
```

Expect `200`, `Content-Type: text/javascript`, `Cache-Control: max-age=300`, a first line naming the local version, and `IDENTICAL`. Any mismatch is a failed deploy: report it.

## 4. Report

Keep it short: tests passed (count), the version deployed, the header check, and the byte-for-byte match. Mention that members who already had the previous file can keep it for up to 5 minutes.
