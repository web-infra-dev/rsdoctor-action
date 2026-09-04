import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('@rsdoctor/client/package.json');
const packageRoot = dirname(packageJsonPath);
const targetRoot = resolve(
  process.cwd(),
  'dist',
  'node_modules',
  '@rsdoctor',
  'client',
);
const clientDistRoot = resolve(packageRoot, 'dist');
const diffHtmlPath = resolve(clientDistRoot, 'diff.html');

rmSync(targetRoot, { recursive: true, force: true });
mkdirSync(targetRoot, { recursive: true });
cpSync(packageJsonPath, resolve(targetRoot, 'package.json'));

const htmlContent = readFileSync(diffHtmlPath, 'utf8');
const assetRefs = [
  ...htmlContent.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/g),
  ...htmlContent.matchAll(/<link\s+href=["'](.+?)["']\s+rel="stylesheet">/g),
].map((match) => match[1]);

const filesToCopy = new Set([
  diffHtmlPath,
  ...assetRefs.map((assetRef) => resolve(clientDistRoot, assetRef)),
]);

for (const sourcePath of filesToCopy) {
  const relativePath = relative(packageRoot, sourcePath);

  if (relativePath.startsWith('..')) {
    throw new Error(
      `Refusing to copy asset outside @rsdoctor/client: ${sourcePath}`,
    );
  }

  const targetPath = resolve(targetRoot, relativePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath);
}

console.log(`Copied @rsdoctor/client diff assets to ${targetRoot}`);
