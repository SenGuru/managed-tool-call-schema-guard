import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

type PackReport = { files: { path: string }[] };
type PackageManifest = {
  name: string;
  private?: boolean;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
type ProductBoundary = {
  version: number;
  open_source: { license: string; license_file: string; workspaces: string[] };
  paid_managed: { license: string; license_file: string; workspaces: string[] };
};

function isPackFile(value: unknown): value is { path: string } {
  return (
    value !== null && typeof value === 'object' && 'path' in value && typeof value.path === 'string'
  );
}

function packReport(value: unknown, workspace: string): PackReport {
  if (!Array.isArray(value) || value.length !== 1)
    throw new Error(`${workspace} report is invalid`);
  const report: unknown = value[0];
  if (
    report === null ||
    typeof report !== 'object' ||
    !('files' in report) ||
    !Array.isArray(report.files) ||
    !report.files.every(isPackFile)
  )
    throw new Error(`${workspace} did not produce an npm package report`);
  return report as PackReport;
}

const expectations = new Map([
  ['@schema-guard/core', ['dist/index.js', 'dist/index.d.ts', 'LICENSE', 'package.json']],
  ['@schema-guard/sdk', ['dist/index.js', 'dist/index.d.ts', 'LICENSE', 'package.json']],
  ['@schema-guard/cli', ['dist/cli.js', 'LICENSE', 'package.json']],
  ['@schema-guard/api', ['dist/server.js', 'LICENSE', 'package.json']],
]);

const boundary = JSON.parse(readFileSync('product-boundary.json', 'utf8')) as ProductBoundary;
if (boundary.version !== 1) throw new Error('Unsupported product-boundary.json version');
if (boundary.open_source.license !== 'MIT')
  throw new Error('Open-source workspaces must use the MIT boundary');
if (boundary.paid_managed.license !== 'LicenseRef-Akriven-Proprietary')
  throw new Error('Paid-managed workspaces must use the Akriven proprietary boundary');
for (const licenseFile of [boundary.open_source.license_file, boundary.paid_managed.license_file])
  if (!statSync(licenseFile).isFile()) throw new Error(`Missing boundary license ${licenseFile}`);

const rootManifest = JSON.parse(readFileSync('package.json', 'utf8')) as PackageManifest;
if (rootManifest.private !== true || rootManifest.license !== 'UNLICENSED')
  throw new Error('The mixed-license root workspace must remain private and UNLICENSED');

const manifests = new Map<string, PackageManifest>();
for (const directory of readdirSync('packages')) {
  const path = join('packages', directory, 'package.json');
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
    manifests.set(manifest.name, manifest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

const publicNames = new Set(boundary.open_source.workspaces);
const managedNames = new Set(boundary.paid_managed.workspaces);
for (const name of publicNames) {
  const manifest = manifests.get(name);
  if (!manifest) throw new Error(`Boundary references missing public workspace ${name}`);
  if (manifest.private === true) throw new Error(`Public workspace ${name} must not be private`);
  if (manifest.license !== 'MIT')
    throw new Error(`Public workspace ${name} must declare license MIT`);
}
for (const name of managedNames) {
  const manifest = manifests.get(name);
  if (!manifest) throw new Error(`Boundary references missing managed workspace ${name}`);
  if (manifest.private !== true)
    throw new Error(`Paid-managed workspace ${name} must be marked private`);
}
for (const [name, manifest] of manifests) {
  if (!publicNames.has(name) && !managedNames.has(name))
    throw new Error(`Workspace ${name} is absent from product-boundary.json`);
  if (!publicNames.has(name)) continue;
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };
  for (const dependency of Object.keys(dependencies))
    if (managedNames.has(dependency))
      throw new Error(`Public workspace ${name} depends on paid-managed workspace ${dependency}`);
}

function sourceFiles(path: string): string[] {
  const metadata = statSync(path);
  if (metadata.isFile()) return [path];
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    if (name === 'dist' || name === 'node_modules' || name.endsWith('.tsbuildinfo')) return [];
    return sourceFiles(child);
  });
}

const publicSourceRoots = [
  'action.yml',
  'conformance',
  'examples',
  'packages/api',
  'packages/cli',
  'packages/core',
  'packages/sdk-typescript',
  'protocol',
  'python',
];
const forbiddenSourceReference =
  /@schema-guard\/(?:managed-local|shared-state|checkpoint-anchor-receiver)|packages\/(?:managed|shared-state|anchor-receiver)/u;
for (const path of publicSourceRoots)
  for (const file of sourceFiles(path)) {
    if (!/\.(?:c?js|mjs|json|py|ts|tsx|ya?ml)$/u.test(file)) continue;
    if (forbiddenSourceReference.test(readFileSync(file, 'utf8')))
      throw new Error(`Open-source file ${relative('.', file)} references paid-managed code`);
  }

for (const [workspace, required] of expectations) {
  if (!publicNames.has(workspace))
    throw new Error(`Package expectation ${workspace} is not in the open-source boundary`);
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--workspace', workspace], {
    encoding: 'utf8',
  });
  const report = packReport(JSON.parse(output) as unknown, workspace);
  const paths = new Set(report.files.map((file) => file.path));
  for (const path of required)
    if (!paths.has(path)) throw new Error(`${workspace} package is missing ${path}`);
}

console.log(
  'Product boundary and package contents are complete for core, SDK, CLI, and local API.',
);
