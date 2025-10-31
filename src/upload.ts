import { DefaultArtifactClient } from '@actions/artifact';
import path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

export function hashPath(pathParts: string[], fileNameWithoutExt: string): string {
  const pathString = `${pathParts.join('-')}-${fileNameWithoutExt}`;
  return createHash('sha256').update(pathString).digest('hex').substring(0, 8);
}

export async function uploadArtifact(filePath: string, commitHash?: string) {
  const artifactClient = new DefaultArtifactClient();
  
  const hash = commitHash || execSync('git rev-parse --short=10 HEAD', { encoding: 'utf8' }).trim();
  
  const targetFilePath = filePath;
  
  if (!targetFilePath || !fs.existsSync(targetFilePath)) {
    throw new Error(`Target file not found: ${targetFilePath}`);
  }
  const fileName = path.basename(targetFilePath);
  
  const relativePath = path.relative(process.cwd(), targetFilePath);
  const pathParts = relativePath.split(path.sep);
  const fileNameWithoutExt = path.parse(fileName).name;
  const fileExt = path.parse(fileName).ext;
  
  const pathHash = hashPath(pathParts, fileNameWithoutExt);
  const artifactName = `${pathHash}-${hash}${fileExt}`;
  
  console.log(`Uploading artifact: ${artifactName}`);
  console.log(`From file: ${targetFilePath}`);
  
  const uploadResponse = await artifactClient.uploadArtifact(
    artifactName,
    [targetFilePath],
    path.dirname(targetFilePath),
  );
  
  return uploadResponse;
}
