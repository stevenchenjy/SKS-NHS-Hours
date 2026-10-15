import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { Linter, type ESLint } from "eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Resolve through the actual installed config/plugin dependency edge. A direct
// tinyglobby test would miss a broken pnpm override or changed plugin call site.
const projectRequire = createRequire(import.meta.url);
const configRequire = createRequire(projectRequire.resolve("eslint-config-next"));
const pluginRequire = createRequire(configRequire.resolve("@next/eslint-plugin-next"));
const nextPlugin = configRequire("@next/eslint-plugin-next") as ESLint.Plugin;
const rootResolverPath = pluginRequire.resolve("./utils/get-root-dirs.js");
const { getRootDirs } = pluginRequire("./utils/get-root-dirs.js") as {
  getRootDirs(context: { cwd: string; settings: { next?: { rootDir?: unknown } } }): string[];
};

let fixture: string;
let literalFixture: string;
let site: string;
let admin: string;

beforeAll(() => {
  fixture = mkdtempSync(path.join(tmpdir(), "nhs-next-eslint-roots-"));
  literalFixture = mkdtempSync(path.join(tmpdir(), "nhs-next-eslint-literals-"));
  site = path.join(fixture, "apps", "site");
  admin = path.join(fixture, "apps", "admin");
  for (const relativePath of [
    "apps/site/pages/dashboard.tsx",
    "apps/site/nested/pages/hidden.tsx",
    "apps/admin/src/app/settings/page.tsx",
    "apps/notes.txt",
  ]) {
    const file = path.join(fixture, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "export default function Page() { return null; }\n");
  }
  for (const relativePath of [
    "app(copy)/pages/literal.tsx",
    "appcopy/pages/decoy.tsx",
    "app{copy}/pages/brace.tsx",
    "app(/pages/unclosed.tsx",
    "group/appfoo/pages/one.tsx",
    "group/appbar/pages/two.tsx",
    "range/app1/pages/one.tsx",
    "range/app2/pages/two.tsx",
  ]) {
    const file = path.join(literalFixture, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "export default function Page() { return null; }\n");
  }
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
  rmSync(literalFixture, { recursive: true, force: true });
});

function roots(rootDir?: unknown, cwd = fixture): string[] {
  return getRootDirs({ cwd, settings: rootDir === undefined ? {} : { next: { rootDir } } });
}

function lint(source: string, rootDir?: unknown) {
  const linter = new Linter({ cwd: fixture });
  return linter.verify(
    source,
    [
      {
        files: ["**/*.jsx"],
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: "module",
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        settings: rootDir === undefined ? {} : { next: { rootDir } },
        plugins: { "@next/next": nextPlugin },
        rules: {
          "@next/next/no-html-link-for-pages": "error",
          "@next/next/no-sync-scripts": "error",
          "@next/next/no-img-element": "error",
        },
      },
    ],
    { filename: path.join(fixture, "example.jsx") },
  );
}

describe("installed Next root directory resolution", () => {
  it("defaults to ESLint's context cwd without expanding descendants", () => {
    expect(roots(undefined, site)).toEqual([site]);
  });

  it("keeps an absolute literal root intact and excludes its nested projects", () => {
    expect(roots(site)).toEqual([site]);
  });

  it("keeps a relative literal root relative and does not expand descendants", () => {
    const relative = path.relative(process.cwd(), site).split(path.sep).join("/");
    expect(roots(relative)).toEqual([relative]);
  });

  it.each(["app(copy)", "app{copy}", "app("])(
    "treats %s as a literal directory under fast-glob's default syntax",
    (directory) => {
      const configured = `${literalFixture}/${directory}`;
      expect(roots(configured)).toEqual([configured]);
    },
  );

  it.each(["app(foo|bar)", "app@(foo|bar)"])(
    "continues expanding supported dynamic grouping syntax %s",
    (pattern) => {
      expect(roots(`${literalFixture}/group/${pattern}`).sort()).toEqual(
        [`${literalFixture}/group/appbar`, `${literalFixture}/group/appfoo`].sort(),
      );
    },
  );

  it("continues expanding a numeric brace range", () => {
    expect(roots(`${literalFixture}/range/app{1..2}`).sort()).toEqual(
      [`${literalFixture}/range/app1`, `${literalFixture}/range/app2`].sort(),
    );
  });

  it("preserves literal trailing slashes and leading dot segments", () => {
    const relative = path.relative(process.cwd(), site).split(path.sep).join("/");
    expect(roots(`${site}/`)).toEqual([`${site}/`]);
    expect(roots(`./${relative}`)).toEqual([`./${relative}`]);
    expect(roots(".")).toEqual(["."]);
    expect(roots("./")).toEqual(["./"]);
  });

  it("preserves leading dot segments on dynamic roots", () => {
    const relative = path.relative(process.cwd(), `${fixture}/apps`).split(path.sep).join("/");
    expect(roots(`./${relative}/*`).sort()).toEqual(
      [`./${relative}/admin`, `./${relative}/site`].sort(),
    );
  });

  it("resolves a filesystem-root literal without enumerating its contents", () => {
    const filesystemRoot = path.parse(fixture).root;
    const checked = spawnSync(
      process.execPath,
      [
        "-e",
        `const fs = require('node:fs');
         fs.readdirSync = () => { throw new Error('Literal root resolution must not enumerate directories'); };
         const { getRootDirs } = require(process.argv[1]);
         console.log(JSON.stringify(getRootDirs({cwd: process.cwd(), settings: {next: {rootDir: process.argv[2]}}})));`,
        rootResolverPath,
        filesystemRoot,
      ],
      { cwd: fixture, encoding: "utf8", timeout: 5_000 },
    );
    expect(checked.stderr).toBe("");
    expect(checked.status).toBe(0);
    expect(JSON.parse(checked.stdout)).toEqual([filesystemRoot]);
  });

  it("resolves absolute glob roots to directories and excludes matched files", () => {
    expect(roots(`${fixture}/apps/*`).sort()).toEqual([admin, site].sort());
  });

  it("resolves brace globs without adding nested roots", () => {
    expect(roots(`${fixture}/apps/{site,admin}`).sort()).toEqual([admin, site].sort());
  });

  it("handles arrays in order while ignoring unmatched and non-string entries", () => {
    expect(roots([admin, null, `${fixture}/missing/*`, 42, site])).toEqual([admin, site]);
  });

  it("does not include the parent when a globstar matches its descendants", () => {
    expect(roots(`${fixture}/apps/**`).sort()).toEqual(
      [
        admin,
        `${admin}/src`,
        `${admin}/src/app`,
        `${admin}/src/app/settings`,
        site,
        `${site}/pages`,
        `${site}/nested`,
        `${site}/nested/pages`,
      ].sort(),
    );
  });

  it("handles a bare terminal globstar without adding the current directory", () => {
    const checked = spawnSync(
      process.execPath,
      [
        "-e",
        `const { getRootDirs } = require(process.argv[1]);
         console.log(JSON.stringify(getRootDirs({cwd: process.cwd(), settings: {next: {rootDir: '**'}}})));`,
        rootResolverPath,
      ],
      { cwd: fixture, encoding: "utf8", timeout: 5_000 },
    );
    expect(checked.stderr).toBe("");
    expect(checked.status).toBe(0);
    expect(JSON.parse(checked.stdout).sort()).toEqual(
      [
        "apps",
        "apps/admin",
        "apps/admin/src",
        "apps/admin/src/app",
        "apps/admin/src/app/settings",
        "apps/site",
        "apps/site/nested",
        "apps/site/nested/pages",
        "apps/site/pages",
      ].sort(),
    );
  });

  it("normalizes Windows-style separators before resolving roots", () => {
    expect(roots(site.replaceAll("/", "\\"))).toEqual([site]);
    expect(roots(`${fixture}/apps/*`.replaceAll("/", "\\")).sort()).toEqual([admin, site].sort());
  });

  it("returns no root for a file or a directory pattern with no matches", () => {
    expect(roots(`${fixture}/apps/notes.txt`)).toEqual([]);
    expect(roots(`${fixture}/does-not-exist/*`)).toEqual([]);
  });
});

describe("installed Next lint diagnostics", () => {
  const internalLink =
    'export default function Screen() { return <a href="/dashboard">Dashboard</a>; }';

  it("detects an internal anchor using the default context root", () => {
    const linter = new Linter({ cwd: site });
    const messages = linter.verify(internalLink, [
      {
        languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { "@next/next": nextPlugin },
        rules: { "@next/next/no-html-link-for-pages": "error" },
      },
    ]);
    expect(messages.map((message) => message.ruleId)).toEqual([
      "@next/next/no-html-link-for-pages",
    ]);
  });

  it.each(["literal", "glob", "brace", "array", "windows"])(
    "still detects internal navigation with a configured %s root",
    (kind) => {
      const settings: Record<string, unknown> = {
        literal: site,
        glob: `${fixture}/apps/*`,
        brace: `${fixture}/apps/{site,admin}`,
        array: [admin, `${fixture}/missing/*`, site],
        windows: site.replaceAll("/", "\\"),
      };
      expect(lint(internalLink, settings[kind]).map((message) => message.ruleId)).toEqual([
        "@next/next/no-html-link-for-pages",
      ]);
    },
  );

  it("does not treat an unconfigured nested project as another root", () => {
    const messages = lint(
      'export default function Screen() { return <a href="/hidden">Outside root</a>; }',
      site,
    );
    expect(messages).toEqual([]);
  });

  it("detects internal navigation inside a directory with literal parentheses", () => {
    const messages = lint(
      'export default function Screen() { return <a href="/literal">Literal root</a>; }',
      `${literalFixture}/app(copy)`,
    );
    expect(messages.map((message) => message.ruleId)).toEqual([
      "@next/next/no-html-link-for-pages",
    ]);
  });

  it("does not lint routes from a similarly named directory without parentheses", () => {
    expect(
      lint(
        'export default function Screen() { return <a href="/decoy">Other project</a>; }',
        `${literalFixture}/app(copy)`,
      ),
    ).toEqual([]);
  });

  it("continues reporting independent Next rules for invalid code", () => {
    const messages = lint(
      'export default function Screen() { return <><script src="/bundle.js" /><img src="/photo.png" alt="Photo" /></>; }',
      site,
    );
    expect(messages.map((message) => message.ruleId).sort()).toEqual([
      "@next/next/no-img-element",
      "@next/next/no-sync-scripts",
    ]);
    expect(messages.every((message) => message.severity === 2 && !message.fatal)).toBe(true);
  });

  it("does not flag external anchors or asynchronous scripts", () => {
    expect(
      lint(
        'export default function Screen() { return <><a href="https://example.edu/dashboard">External</a><script async src="/bundle.js" /></>; }',
        site,
      ),
    ).toEqual([]);
  });
});

describe("Next glob dependency remediation", () => {
  it("uses the replacement through the installed plugin dependency", () => {
    expect(pluginRequire.resolve("fast-glob").replaceAll("\\", "/")).toContain("/tinyglobby/");
  });

  it("does not retain the vulnerable braces dependency in the resolved lockfile", () => {
    const lockfile = readFileSync(path.join(process.cwd(), "pnpm-lock.yaml"), "utf8");
    expect(lockfile).not.toMatch(/^ {2}braces@/m);
  });
});
