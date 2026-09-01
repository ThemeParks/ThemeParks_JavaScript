---
title: Spec drift — regenerated schema does not build
---

The daily `spec-drift` workflow regenerated `src/_generated/schema.ts` from
`api.themeparks.wiki/docs/v1.yaml`, and the package no longer builds against it.

That means the upstream contract has changed in a way this client cannot absorb
automatically — a renamed or removed component schema, or a response type that
is no longer named. Check the build log on the workflow run, and the drift PR if
one was opened alongside this issue.

This used to fail silently: the build step ran before the pull-request step with
no `continue-on-error`, so a broken regeneration produced no PR, no smoke tests
and no issue. It went unnoticed for months. Do not restore that ordering.
