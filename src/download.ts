import path from 'path';
import * as fs from 'fs';
import { GitHubService } from './github';
import * as yauzl from 'yauzl';
import { hashPath } from './upload';

export async function downloadArtifact(artifactId: number, fileName: string) {
  console.log(`📥 Downloading artifact ID: ${artifactId}`);
  
  const githubService = new GitHubService();
  
  try {
    const downloadResponse = await githubService.downloadArtifact(artifactId);
    
    const tempDir = path.join(process.cwd(), 'temp-artifact');
    await fs.promises.mkdir(tempDir, { recursive: true });
    
    const zipPath = path.join(tempDir, 'artifact.zip');
    const buffer = Buffer.from(downloadResponse);
    await fs.promises.writeFile(zipPath, buffer);
    
    console.log(`✅ Downloaded artifact zip to: ${zipPath}`);
    
    await new Promise<void>((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) return reject(err);
        
        zipfile.readEntry();
        zipfile.on('entry', (entry) => {
          if (/\/$/.test(entry.fileName)) {
            zipfile.readEntry();
          } else {
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) return reject(err);
              
              const outputPath = path.join(tempDir, entry.fileName);
              const outputDir = path.dirname(outputPath);
              
              fs.promises.mkdir(outputDir, { recursive: true }).then(() => {
                const writeStream = fs.createWriteStream(outputPath);
                readStream.pipe(writeStream);
                writeStream.on('close', () => zipfile.readEntry());
              });
            });
          }
        });
        
        zipfile.on('end', () => resolve());
        zipfile.on('error', reject);
      });
    });
    
    console.log(`✅ Extracted artifact to: ${tempDir}`);
    
    const extractedFiles = await fs.promises.readdir(tempDir, { recursive: true });
    console.log(`📁 Extracted files: ${extractedFiles.join(', ')}`);
    
    let targetFilePath: string | null = null;
    for (const file of extractedFiles) {
      if (file === fileName || file.endsWith(fileName)) {
        targetFilePath = path.join(tempDir, file);
        break;
      }
    }
    
    if (!targetFilePath) {
      throw new Error(`Target file ${fileName} not found in extracted artifact`);
    }
    
    console.log(`📄 Found target file: ${targetFilePath}`);
    
    const fileContent = await fs.promises.readFile(targetFilePath, 'utf-8');
    const jsonData = JSON.parse(fileContent);
    
    console.log('--- Downloaded Artifact JSON Data ---');
    
    await fs.promises.unlink(zipPath);
    
    return {
      downloadPath: tempDir,
      jsonData: jsonData
    };
    
  } catch (error) {
    console.error(`❌ Failed to download and extract artifact: ${error}`);
    throw error;
  }
}

export async function downloadArtifactByCommitHash(
  commitHash: string, 
  fileName: string,
  filePath?: string
) {
  console.log(`🔍 Looking for artifact with commit hash: ${commitHash}`);
  
  const githubService = new GitHubService();
  
  let artifact;
  
  // If filePath is provided, calculate path hash and search for exact match
  if (filePath) {
    const relativePath = path.relative(process.cwd(), filePath);
    const pathParts = relativePath.split(path.sep);
    const fileNameWithoutExt = path.parse(fileName).name;
    const fileExt = path.parse(fileName).ext;
    const pathHash = hashPath(pathParts, fileNameWithoutExt);
    const expectedArtifactName = `${pathHash}-${commitHash}${fileExt}`;
    
    console.log(`📋 Searching for artifact with path hash and commit hash: ${expectedArtifactName}`);
    console.log(`   Path hash: ${pathHash}`);
    console.log(`   File path: ${relativePath}`);
    
    // List all artifacts and find the exact match
    const artifacts = await githubService.listArtifacts();
    artifact = artifacts.artifacts.find((a: any) => a.name === expectedArtifactName);
    
    if (artifact) {
      console.log(`✅ Found exact match: ${artifact.name} (ID: ${artifact.id})`);
    } else {
      console.log(`⚠️  Exact match not found, trying fallback search by commit hash only`);
    }
  }
  
  // Fallback: search by commit hash only (for backward compatibility)
  if (!artifact) {
    console.log(`📋 Searching for artifacts matching commit hash: ${commitHash}`);
    artifact = await githubService.findArtifactByNamePattern(commitHash);
  }
  
  if (!artifact) {
    console.log(`❌ No artifact found for commit hash: ${commitHash}`);
    if (filePath) {
      console.log(`   Also tried searching with path hash from: ${filePath}`);
    }
    console.log(`💡 This might mean:`);
    console.log(`   - The target branch hasn't been built yet`);
    console.log(`   - The artifact name pattern doesn't match`);
    console.log(`   - The artifact has expired (GitHub artifacts expire after 90 days)`);
    throw new Error(`No artifact found for commit hash: ${commitHash}`);
  }

  console.log(`✅ Found artifact: ${artifact.name} (ID: ${artifact.id})`);
  
  try {
    const artifacts = await githubService.listArtifacts();
    interface Artifact {
      id: number;
      name: string;
      created_at: string;
      expired_at?: string;
      size_in_bytes: number;
    }
    const artifactDetails = artifacts.artifacts.find((a: Artifact) => a.id === artifact.id);
    if (artifactDetails) {
      console.log(`📊 Artifact details:`);
      console.log(`   - Created: ${artifactDetails.created_at}`);
      console.log(`   - Expired: ${artifactDetails.expired_at || 'Not expired'}`);
      console.log(`   - Size: ${artifactDetails.size_in_bytes} bytes`);
      
      if (artifactDetails.expired_at) {
        console.log(`⚠️  Warning: This artifact has expired and may not be downloadable`);
      }
    }
  } catch (detailError) {
    console.warn(`⚠️  Could not get artifact details: ${detailError || 'Unknown error'}`);
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
