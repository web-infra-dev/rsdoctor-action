import path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

export const ARTIFACT_NAME_PREFIX = 'rsdoctor';

export function hashPath(
  pathParts: string[],
  fileNameWithoutExt: string,
): string {
  const pathString = `${pathParts.join('-')}-${fileNameWithoutExt}`;
  return createHash('sha256').update(pathString).digest('hex').substring(0, 8);
}

export function createArtifactName(
  pathHash: string,
  commitHash: string,
): string {
  return `${ARTIFACT_NAME_PREFIX}-${pathHash}-${commitHash}`;
}

/**
 * Artifact names historically use a 10-character SHA. Keep that stable while
 * allowing callers to use the full SHA required by GitHub API filters.
 */
export function formatArtifactCommitHash(commitHash: string): string {
  return /^[0-9a-f]{40}$/i.test(commitHash)
    ? commitHash.substring(0, 10)
    : commitHash;
}

export async function uploadArtifact(filePath: string, commitHash?: string) {
  const { DefaultArtifactClient } = await import(
    /* webpackChunkName: "actions-artifact" */ '@actions/artifact'
  );
  const artifactClient = new DefaultArtifactClient();

  const hash = formatArtifactCommitHash(
    commitHash ||
      execSync('git rev-parse --short=10 HEAD', { encoding: 'utf8' }).trim(),
  );

  const targetFilePath = filePath;

  if (!targetFilePath || !fs.existsSync(targetFilePath)) {
    throw new Error(`Target file not found: ${targetFilePath}`);
  }
  const fileName = path.basename(targetFilePath);

  const relativePath = path.relative(process.cwd(), targetFilePath);
  const pathParts = relativePath.split(path.sep);
  const fileNameWithoutExt = path.parse(fileName).name;

  const pathHash = hashPath(pathParts, fileNameWithoutExt);
  const artifactName = createArtifactName(pathHash, hash);

  console.log(`Uploading artifact: ${artifactName}`);
  console.log(`From file: ${targetFilePath}`);

  const uploadResponse = await artifactClient.uploadArtifact(
    artifactName,
    [targetFilePath],
    path.dirname(targetFilePath),
  );

  return uploadResponse;
}
