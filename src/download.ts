import path from 'path';
import * as fs from 'fs';
import { GitHubService } from './github';
import * as yauzl from 'yauzl';
import { createArtifactName, formatArtifactCommitHash, hashPath } from './upload';

const ARTIFACT_EXTRACT_TIMEOUT_MS = 30_000;

type OpenZipFromBuffer = (
  buffer: Buffer,
  options: yauzl.Options,
  callback: (error: Error | null, zipfile: yauzl.ZipFile) => void,
) => void;

function isTargetEntry(entryName: string, fileName: string): boolean {
  return entryName === fileName || entryName.endsWith(`/${fileName}`);
}

export function readArtifactFileFromZip(
  zipBuffer: Buffer,
  fileName: string,
  timeoutMs = ARTIFACT_EXTRACT_TIMEOUT_MS,
  openZip: OpenZipFromBuffer = yauzl.fromBuffer,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let zipfile: yauzl.ZipFile | undefined;

    const finish = (error?: Error, content?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (zipfile?.isOpen) {
        zipfile.close();
      }

      if (error) {
        reject(error);
      } else if (content) {
        resolve(content);
      } else {
        reject(new Error(`Target file ${fileName} could not be read from artifact`));
      }
    };

    // Keep the event loop alive and fail explicitly if the ZIP callback chain stalls.
    const timeout = setTimeout(() => {
      finish(new Error(`Timed out after ${timeoutMs}ms while extracting ${fileName}`));
    }, timeoutMs);

    openZip(zipBuffer, { lazyEntries: true }, (openError, openedZipfile) => {
      if (openError) {
        finish(openError);
        return;
      }

      zipfile = openedZipfile;
      zipfile.once('error', finish);
      zipfile.once('end', () => {
        finish(new Error(`Target file ${fileName} not found in artifact`));
      });
      zipfile.on('entry', (entry) => {
        if (!isTargetEntry(entry.fileName, fileName)) {
          zipfile?.readEntry();
          return;
        }

        zipfile?.openReadStream(entry, (streamError, readStream) => {
          if (streamError) {
            finish(streamError);
            return;
          }

          const chunks: Buffer[] = [];
          readStream.once('error', finish);
          readStream.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          readStream.once('end', () => {
            finish(undefined, Buffer.concat(chunks));
          });
        });
      });
      zipfile.readEntry();
    });
  });
}

export async function downloadArtifact(artifactId: number, fileName: string) {
  console.log(`📥 Downloading artifact ID: ${artifactId}`);
  
  const githubService = new GitHubService();
  
  try {
    const downloadResponse = await githubService.downloadArtifact(artifactId);

    const zipBuffer = Buffer.from(downloadResponse);
    console.log(`✅ Downloaded artifact ZIP (${zipBuffer.length} bytes)`);

    const fileBuffer = await readArtifactFileFromZip(zipBuffer, fileName);
    const fileContent = fileBuffer.toString('utf-8');
    const jsonData = JSON.parse(fileContent);

    const tempDir = path.join(process.cwd(), 'temp-artifact', String(artifactId));
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    await fs.promises.mkdir(tempDir, { recursive: true });
    const targetFilePath = path.join(tempDir, fileName);
    await fs.promises.writeFile(targetFilePath, fileBuffer);

    console.log(`✅ Extracted target file to: ${targetFilePath}`);
    
    return {
      downloadPath: tempDir,
      jsonData
    };
    
  } catch (error) {
    console.error(`❌ Failed to download and extract artifact: ${error}`);
    throw error;
  }
}

export async function downloadArtifactByCommitHash(
  commitHash: string, 
  fileName: string,
  filePath: string
) {
  if (!filePath) {
    throw new Error('filePath is required for artifact download');
  }
  
  console.log(`🔍 Looking for artifact with commit hash: ${commitHash}`);
  
  const githubService = new GitHubService();
  
  // Calculate path hash and search for exact match
  const relativePath = path.relative(process.cwd(), filePath);
  const pathParts = relativePath.split(path.sep);
  const fileNameWithoutExt = path.parse(fileName).name;
  const fileExt = path.parse(fileName).ext;
  const pathHash = hashPath(pathParts, fileNameWithoutExt);
  const artifactCommitHash = formatArtifactCommitHash(commitHash);
  const expectedArtifactName = createArtifactName(pathHash, artifactCommitHash);
  // Keep the historical short-SHA format as the primary name, while accepting
  // full-SHA and pre-prefix names created by earlier or transitional versions.
  const compatibleArtifactNames = new Set([
    expectedArtifactName,
    createArtifactName(pathHash, commitHash),
    `${pathHash}-${artifactCommitHash}`,
    `${pathHash}-${artifactCommitHash}${fileExt}`,
    `${pathHash}-${commitHash}`,
    `${pathHash}-${commitHash}${fileExt}`,
  ]);

  console.log(`📋 Searching for artifact with path hash and commit hash: ${expectedArtifactName}`);
  console.log(`   Path hash: ${pathHash}`);
  console.log(`   File path: ${relativePath}`);
  
  // Try to find all workflow runs by commit hash first (more efficient)
  console.log(`🔍 Looking for workflow runs with commit hash: ${commitHash}`);
  const workflowRuns = await githubService.findAllWorkflowRunsByCommit(commitHash);
  
  let artifact: any = null;
  let artifacts: any = null;
  
  if (workflowRuns && workflowRuns.length > 0) {
    console.log(`✅ Found ${workflowRuns.length} workflow run(s) for commit ${commitHash}`);
    
    // Search through all workflow runs, starting with the highest priority ones
    for (const workflowRun of workflowRuns) {
      console.log(`\n🔍 Checking workflow run: ${workflowRun.id} (${workflowRun.name || 'unnamed'})`);
      console.log(`   Status: ${workflowRun.status}, Conclusion: ${workflowRun.conclusion}`);
      
      try {
        const runArtifacts = await githubService.listArtifactsForWorkflowRun(workflowRun.id);
        const foundArtifact = runArtifacts.artifacts?.find(
          (a: any) => compatibleArtifactNames.has(a.name),
        );
        
        if (foundArtifact) {
          artifact = foundArtifact;
          artifacts = runArtifacts;
          console.log(`✅ Found artifact in workflow run ${workflowRun.id}: ${artifact.name} (ID: ${artifact.id})`);
          break; // Found it, stop searching
        } else {
          const artifactNames = runArtifacts.artifacts?.map((a: any) => a.name).join(', ') || 'none';
          console.log(`   ⚠️  Artifact not found. Available artifacts: ${artifactNames}`);
        }
      } catch (runArtifactsError) {
        console.warn(`   ⚠️  Failed to get artifacts from workflow run ${workflowRun.id}: ${runArtifactsError}`);
        continue; // Try next workflow run
      }
    }
    
    if (!artifact) {
      console.log(`\n⚠️  Artifact not found in any of the ${workflowRuns.length} workflow runs`);
      console.log(`🔄 Falling back to listing all repository artifacts...`);
    }
  } else {
    console.log(`⚠️  No workflow runs found for commit ${commitHash}`);
    console.log(`🔄 Falling back to listing all repository artifacts...`);
  }
  
  // Fallback: if not found in any workflow run, search all repository artifacts
  if (!artifact) {
    artifacts = await githubService.listArtifacts();
    artifact = artifacts.artifacts.find(
      (a: any) => compatibleArtifactNames.has(a.name),
    );
  }
  
  if (!artifact) {
    console.log(`❌ No artifact found matching: ${expectedArtifactName}`);
    if (artifacts?.artifacts) {
      console.log(`   Available artifacts: ${artifacts.artifacts.map((a: any) => a.name).join(', ')}`);
    }
    console.log(`💡 This might mean:`);
    console.log(`   - The target branch hasn't been built yet`);
    console.log(`   - The artifact name pattern doesn't match`);
    console.log(`   - The artifact has expired (GitHub artifacts expire after 90 days)`);
    throw new Error(`No artifact found matching: ${expectedArtifactName}`);
  }
  
  console.log(`✅ Found exact match: ${artifact.name} (ID: ${artifact.id})`);
  
  // Display artifact details
  interface Artifact {
    id: number;
    name: string;
    created_at: string;
    expired_at?: string;
    size_in_bytes: number;
  }
  const artifactDetails = artifact as Artifact;
  if (artifactDetails) {
    console.log(`📊 Artifact details:`);
    console.log(`   - Created: ${artifactDetails.created_at}`);
    console.log(`   - Expired: ${artifactDetails.expired_at || 'Not expired'}`);
    console.log(`   - Size: ${artifactDetails.size_in_bytes} bytes`);
    
    if (artifactDetails.expired_at) {
      console.log(`⚠️  Warning: This artifact has expired and may not be downloadable`);
    }
  }
  
  console.log(`📥 Downloading artifact...`);

  try {
    return await downloadArtifact(artifact.id, fileName);
  } catch (downloadError) {
    console.error(`❌ Download failed with error: ${downloadError}`);
    console.error(`💡 This usually means:`);
    console.error(`   - Token lacks 'actions:read' permission for downloading artifacts`);
    console.error(`   - Artifact is from a different workflow run`);
    console.error(`   - Artifact download URL is expired or invalid`);
    console.error(`   - Network or GitHub API issues`);
    throw downloadError;
  }
}
