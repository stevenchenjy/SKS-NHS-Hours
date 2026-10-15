# Dependency security maintenance

The October 15, 2026 remediation removes the dependency paths affected by
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The official `braces` package still has no published patched release. The
resolved project graph instead excludes `braces`, `micromatch`, and `fast-glob`.
The standard dependency audit remains enabled without an advisory exception.

## UI stylesheet

The application consumed only `shadcn/tailwind.css` from the shadcn CLI package.
Its complete version 4.19.0 stylesheet now lives in
`src/styles/shadcn-tailwind.css`, with its original MIT license and provenance.
`src/app/globals.css` imports that local file. This retains the data-state
variants, animation utilities, scrollbar styles, and other definitions used by
the local UI components while removing the CLI dependency tree.

## Next.js lint root discovery

Next's ESLint plugin 16.3.8 uses `fast-glob` only for synchronous directory
discovery in its `get-root-dirs` utility. The parent-scoped override in
`pnpm-workspace.yaml` resolves that dependency edge to `tinyglobby@0.2.17`.
This is limited to the inspected Next plugin; it is not a universal alias for
other consumers of the fast-glob API.

A tracked pnpm patch adapts the plugin's call to tinyglobby's directory-expansion
and path defaults. The regression suite in
`src/lib/next-eslint-root-resolution.test.ts` exercises the actual installed
plugin and its lint diagnostics, including configured roots and exclusion of
unconfigured nested applications. Next's lint rules and their severities remain
enabled.

Literal directory names such as `app(copy)` resolve only to that exact existing
directory. This also corrects an inherited fast-glob filtering edge case that
could omit the configured literal root; it must never widen the lint scope to a
similarly named `appcopy` directory. The regression suite covers both outcomes.

When upgrading `eslint-config-next` or Next's ESLint plugin, review this override
and patch together. Prefer the upstream implementation once its graph excludes
the affected dependency; run the root-resolution tests and full lint suite
before removing the compatibility patch. Keep the replacement version pinned
until its API and behavior have been checked again.

## Verification

Use the project's pnpm 11.19.0 version and supported Node version:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm audit --audit-level=high
```

CI runs the dependency audit as an application gate before authenticated browser
tests. A green audit requires a successful registry response with no applicable
advisory; excluding development dependencies or ignoring the advisory does not
establish remediation. For stylesheet changes, rebuild before comparing compiled
CSS or inspecting the rendered desktop and mobile UI.
