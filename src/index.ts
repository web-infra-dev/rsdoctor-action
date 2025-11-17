import { setFailed, getInput, summary } from '@actions/core';
import { uploadArtifact, hashPath } from './upload';
import { downloadArtifactByCommitHash } from './download';
import { GitHubService } from './github';
import { loadSizeData, generateSizeReport, parseRsdoctorData, generateBundleAnalysisReport, BundleAnalysis, generateProjectMarkdown } from './report';
import path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { spawnSync } from 'child_process';
import fg from 'fast-glob';
const execFileAsync = promisify(execFile);

function isMergeEvent(): boolean {
  const { context } = require('@actions/github');
  const isPR = context.eventName === 'pull_request';

  if (isPR) {
    const prAction = context.payload.action;
    const prMerged = context.payload.pull_request?.merged;
    const prNumber = context.payload.pull_request?.number;
    const baseRef = context.payload.pull_request?.base?.ref;
    const headRef = context.payload.pull_request?.head?.ref;

    // Check if this is a merge event: PR closed and merged
    const isMerge = prAction === 'closed' && prMerged === true;

    if (isMerge) {
      console.log(`🔄 Detected merge event: pull request closed and merged`);
      console.log(`   Event: ${context.eventName}, Action: ${prAction}`);
      console.log(`   PR #${prNumber}: ${headRef} -> ${baseRef}`);
      console.log(`   Merged: ${prMerged}`);
      console.log(`   This is a merge event - branch was merged to ${baseRef}`);
    }

    return isMerge;
  }

  return false;
}

function isPullRequestEvent(): boolean {
  const { context } = require('@actions/github');
  const isPR = context.eventName === 'pull_request';

  if (isPR) {
    const prAction = context.payload.action;
    const prMerged = context.payload.pull_request?.merged;
    const prNumber = context.payload.pull_request?.number;
    const baseRef = context.payload.pull_request?.base?.ref;
    const headRef = context.payload.pull_request?.head?.ref;

    // Skip if PR is closed and merged - this should be handled by isMergeEvent
    if (prAction === 'closed' && prMerged === true) {
      console.log(`ℹ️  PR is closed and merged - this should be handled by merge event logic`);
      return false;
    }

    console.log(`📥 Detected pull request event`);
    console.log(`   Action: ${prAction}`);
    console.log(`   PR #${prNumber}: ${headRef} -> ${baseRef}`);
    console.log(`   Merged: ${prMerged}`);
    console.log(`   This is a PR review/update event - comparing with baseline`);
  }

  return isPR;
}

function runRsdoctorViaNode(requirePath: string, args: string[] = []) {
  const nodeExec = process.execPath;
  console.log('process.execPath =', nodeExec);
  console.log('Running:', nodeExec, requirePath, args.join(' '));
  const r = spawnSync(nodeExec, [requirePath, ...args], { stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`rsdoctor exited with code ${r.status}`);
}

interface ProjectReport {
  projectName: string;
  filePath: string;
  current: BundleAnalysis | null;
  baseline: BundleAnalysis | null;
  diffHtmlPath?: string;
  diffHtmlArtifactId?: number;
}

/**
 * Extract project name from file path for display
 */
function extractProjectName(filePath: string): string {
  const relativePath = path.relative(process.cwd(), filePath);
  const pathParts = relativePath.split(path.sep);
  
  // Try to identify sub-project name from common monorepo patterns
  const monorepoPatterns = ['packages', 'apps', 'projects', 'libs', 'modules'];
  const patternIndex = pathParts.findIndex(part => monorepoPatterns.includes(part));
  
  if (patternIndex >= 0 && patternIndex + 1 < pathParts.length) {
    return pathParts[patternIndex + 1];
  }
  
  // Fallback: use directory name containing the file
  if (pathParts.length > 1) {
    return pathParts[pathParts.length - 2];
  }
  
  return pathParts[0] || 'root';
}

/**
 * Process a single file: upload, download baseline, generate diff
 */
async function processSingleFile(
  fullPath: string,
  currentCommitHash: string,
  targetCommitHash: string | null,
  githubService: GitHubService
): Promise<ProjectReport> {
  const fileName = path.basename(fullPath);
  const relativePath = path.relative(process.cwd(), fullPath);
  const pathParts = relativePath.split(path.sep);
  const fileNameWithoutExt = path.parse(fileName).name;
  const fileExt = path.parse(fileName).ext;
  const projectName = extractProjectName(fullPath);
  
  console.log(`\n📦 Processing project: ${projectName}`);
  console.log(`   File: ${relativePath}`);
  
  const report: ProjectReport = {
    projectName,
    filePath: relativePath,
    current: null,
    baseline: null
  };
  
  // Parse current bundle analysis
  const currentBundleAnalysis = parseRsdoctorData(fullPath);
  if (!currentBundleAnalysis) {
    console.warn(`⚠️ Failed to parse rsdoctor data from ${fullPath}, skipping...`);
    return report;
  }
  report.current = currentBundleAnalysis;
  
  // Try to download baseline if in PR event
  if (targetCommitHash) {
    try {
      console.log(`📥 Attempting to download baseline for ${projectName}...`);
      const downloadResult = await downloadArtifactByCommitHash(targetCommitHash, fileName);
      const downloadedBaselinePath = path.join(downloadResult.downloadPath, fileName);
      
      console.log(`📁 Downloaded baseline file path: ${downloadedBaselinePath}`);
      const baselineBundleAnalysis = parseRsdoctorData(downloadedBaselinePath);
      if (baselineBundleAnalysis) {
        report.baseline = baselineBundleAnalysis;
        console.log(`✅ Successfully downloaded and parsed baseline for ${projectName}`);
      }
    } catch (downloadError) {
      console.log(`❌ Failed to download baseline for ${projectName}: ${downloadError}`);
      console.log(`ℹ️  No baseline data found for ${projectName}`);
    }
  }
  
  // Generate rsdoctor HTML diff if baseline exists
  if (report.baseline && targetCommitHash) {
    try {
      const tempOutDir = process.cwd();
      const targetArtifactName = `${pathParts.join('-')}-${fileNameWithoutExt}-${targetCommitHash}${fileExt}`;
      console.log(`🔍 Looking for target artifact: ${targetArtifactName}`);
      
      const downloadResult = await downloadArtifactByCommitHash(targetCommitHash, fileName);
      const baselineJsonPath = path.join(downloadResult.downloadPath, fileName);
      
      try {
        const cliEntry = require.resolve('@rsdoctor/cli', { paths: [process.cwd()] });
        const binCliEntry = path.join(path.dirname(path.dirname(cliEntry)), 'bin', 'rsdoctor');
        console.log(`🔍 Found rsdoctor CLI at: ${binCliEntry}`);
        
        runRsdoctorViaNode(binCliEntry, [
          'bundle-diff', 
          '--html', 
          `--baseline=${baselineJsonPath}`, 
          `--current=${fullPath}`
        ]);
      } catch (e) {
        console.log(`⚠️ rsdoctor CLI not found in node_modules: ${e}`);
        
        try {
          const shellCmd = `npx @rsdoctor/cli bundle-diff --html --baseline="${baselineJsonPath}" --current="${fullPath}"`;
          console.log(`🛠️ Running rsdoctor via npx: ${shellCmd}`);
          await execFileAsync('sh', ['-c', shellCmd], { cwd: tempOutDir });
        } catch (npxError) {
          console.log(`⚠️ npx approach also failed: ${npxError}`);
        }
      }

      const diffHtmlPath = path.join(tempOutDir, `rsdoctor-diff-${projectName}.html`);
      // Try to rename if default name exists
      const defaultDiffPath = path.join(tempOutDir, 'rsdoctor-diff.html');
      if (fs.existsSync(defaultDiffPath)) {
        try {
          await fs.promises.rename(defaultDiffPath, diffHtmlPath);
        } catch (e) {
          // If rename fails, just use default path
          report.diffHtmlPath = defaultDiffPath;
        }
      }
      
      if (!report.diffHtmlPath) {
        report.diffHtmlPath = fs.existsSync(diffHtmlPath) ? diffHtmlPath : defaultDiffPath;
      }
      
      if (fs.existsSync(report.diffHtmlPath)) {
        try {
          const uploadRes = await uploadArtifact(report.diffHtmlPath, currentCommitHash);
          if (typeof uploadRes.id === 'number') {
            report.diffHtmlArtifactId = uploadRes.id;
            console.log(`✅ Uploaded bundle diff HTML for ${projectName}, artifact id: ${uploadRes.id}`);
          }
        } catch (e) {
          console.warn(`⚠️ Failed to upload diff html for ${projectName}: ${e}`);
        }
      }
    } catch (e) {
      console.warn(`⚠️ rsdoctor bundle-diff failed for ${projectName}: ${e}`);
    }
  }
  
  return report;
}

(async () => {
  try {
    const githubService = new GitHubService();
    
    const filePathPattern = getInput('file_path');
    if (!filePathPattern) {
      throw new Error('file_path is required');
    }
    
    // Support glob patterns for monorepo
    const matchedFiles = await fg(filePathPattern, {
      cwd: process.cwd(),
      absolute: true,
      onlyFiles: true
    });
    
    if (matchedFiles.length === 0) {
      throw new Error(`No files found matching pattern: ${filePathPattern}`);
    }
    
    console.log(`📁 Found ${matchedFiles.length} file(s) matching pattern: ${filePathPattern}`);
    matchedFiles.forEach((file, index) => {
      console.log(`  ${index + 1}. ${file}`);
    });
    
    const currentCommitHash = githubService.getCurrentCommitHash();
    console.log(`Current commit hash: ${currentCommitHash}`);
    
    let targetCommitHash: string | null = null;
    if (isPullRequestEvent()) {
      try {
        console.log('🔍 Getting target branch commit hash...');
        targetCommitHash = await githubService.getTargetBranchLatestCommit();
        console.log(`✅ Target branch commit hash: ${targetCommitHash}`);
      } catch (error) {
        console.error(`❌ Failed to get target branch commit: ${error}`);
        console.log('📝 No baseline data available for comparison');
      }
    }
    
    // Process all matched files
    const projectReports: ProjectReport[] = [];
    
    for (const fullPath of matchedFiles) {
      if (isMergeEvent()) {
        console.log('🔄 Detected merge event - uploading current branch artifact');
        
        const uploadResponse = await uploadArtifact(fullPath, currentCommitHash);
        
        if (typeof uploadResponse.id !== 'number') {
          console.warn(`⚠️ Artifact upload failed for ${fullPath}`);
        } else {
          console.log(`✅ Successfully uploaded artifact with ID: ${uploadResponse.id}`);
        }
        
        const currentBundleAnalysis = parseRsdoctorData(fullPath);
        if (currentBundleAnalysis) {
          await generateBundleAnalysisReport(currentBundleAnalysis);
        } else {
          const currentSizeData = loadSizeData(fullPath);
          if (currentSizeData) {
            await generateSizeReport(currentSizeData);
          }
        }
        
      } else if (isPullRequestEvent()) {
        console.log('📥 Detected pull request event - processing files');
        
        // Process single file and collect report
        const report = await processSingleFile(fullPath, currentCommitHash, targetCommitHash, githubService);
        projectReports.push(report);
        
        // Generate report for summary
        if (report.current) {
          await generateBundleAnalysisReport(report.current, report.baseline || undefined);
        }
      }
    }
    
    // Generate combined PR comment for all projects
    if (isPullRequestEvent() && projectReports.length > 0) {
      const { context } = require('@actions/github');
      
      let commentBody = '## Rsdoctor Bundle Diff Analysis\n\n';
      
      // Add summary for multiple projects
      if (projectReports.length > 1) {
        commentBody += `Found ${projectReports.length} project(s) in monorepo.\n\n`;
      }
      
      // Generate markdown for each project
      for (const report of projectReports) {
        if (!report.current) continue;
        
        commentBody += generateProjectMarkdown(report.projectName, report.filePath, report.current, report.baseline || undefined);
        
        // Add diff HTML link if available
        if (report.diffHtmlArtifactId) {
          const artifactDownloadLink = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/artifacts/${report.diffHtmlArtifactId}`;
          commentBody += `\n📦 **Download Diff Report**: [${report.projectName} Bundle Diff](${artifactDownloadLink})\n\n`;
        }
      }
      
      commentBody += '*Generated by Rsdoctor Action*';
      
      try {
        await githubService.updateOrCreateComment(
          context.payload.pull_request.number,
          commentBody
        );
        console.log('✅ Added/updated bundle diff comment to PR');
      } catch (commentError) {
        console.warn(`⚠️ Failed to add/update comment to PR: ${commentError}`);
      }
    }
    
    if (!isMergeEvent() && !isPullRequestEvent()) {
      console.log('ℹ️ Skipping artifact operations - this action only runs on merge events and pull requests');
      console.log('Current event:', process.env.GITHUB_EVENT_NAME);
      return;
    }

  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    } else {
      setFailed(String(error));
    }
  }
})();
