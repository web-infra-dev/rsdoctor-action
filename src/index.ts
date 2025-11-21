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
  baselineCommitHash?: string | null;
  baselinePRs?: Array<{ number: number; title: string; url: string }>;
  diffHtmlPath?: string;
  diffHtmlArtifactId?: number;
}

function extractProjectName(filePath: string): string {
  const relativePath = path.relative(process.cwd(), filePath);
  const pathParts = relativePath.split(path.sep);
  
  const buildOutputDirs = ['dist', '.rsdoctor', 'output', '.next', 'public'];
  
  const monorepoPatterns = ['packages', 'apps', 'projects', 'libs', 'modules', 'examples'];
  const patternIndex = pathParts.findIndex(part => monorepoPatterns.includes(part));
  
  if (patternIndex >= 0 && patternIndex + 1 < pathParts.length) {
    for (let i = patternIndex + 1; i < pathParts.length; i++) {
      const part = pathParts[i];
      if (!buildOutputDirs.includes(part)) {
        return part;
      }
    }
  }
  
  for (let i = pathParts.length - 2; i >= 0; i--) {
    const part = pathParts[i];
    if (!buildOutputDirs.includes(part)) {
      return part;
    }
  }
  
  // Last resort: use first meaningful part
  return pathParts[0] || 'root';
}

/**
 * Process a single file: upload, download baseline, generate diff
 */
async function processSingleFile(
  fullPath: string,
  currentCommitHash: string,
  targetCommitHash: string | null,
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
  
  let baselineJsonPath: string | null = null;
  let baselinePRs: Array<{ number: number; title: string; url: string }> = [];
  if (targetCommitHash) {
    try {
      console.log(`📥 Attempting to download baseline for ${projectName}...`);
      // Pass filePath to ensure we download the correct artifact by path hash
      const downloadResult = await downloadArtifactByCommitHash(targetCommitHash, fileName, fullPath);
      baselineJsonPath = path.join(downloadResult.downloadPath, fileName);
      
      console.log(`📁 Downloaded baseline file path: ${baselineJsonPath}`);
      const baselineBundleAnalysis = parseRsdoctorData(baselineJsonPath);
      if (baselineBundleAnalysis) {
        report.baseline = baselineBundleAnalysis;
        report.baselineCommitHash = targetCommitHash;
        
        // Try to find associated PRs for the baseline commit
        try {
          const githubService = new GitHubService();
          baselinePRs = await githubService.findPRsByCommit(targetCommitHash);
          if (baselinePRs.length > 0) {
            report.baselinePRs = baselinePRs;
            console.log(`📎 Found ${baselinePRs.length} PR(s) associated with baseline commit ${targetCommitHash}`);
          }
        } catch (prError) {
          console.log(`ℹ️  Could not find PRs for baseline commit: ${prError}`);
        }
        
        console.log(`✅ Successfully downloaded and parsed baseline for ${projectName}`);
      }
    } catch (downloadError) {
      console.log(`❌ Failed to download baseline for ${projectName}: ${downloadError}`);
      console.log(`ℹ️  No baseline data found for ${projectName} - skipping bundle diff for this project`);
      // Don't set baseline, so bundle diff won't be generated
      baselineJsonPath = null;
    }
  }
  
  // Generate rsdoctor HTML diff if baseline exists
  if (report.baseline && baselineJsonPath) {
    try {
      const tempOutDir = process.cwd();
      const targetArtifactName = `${pathParts.join('-')}-${fileNameWithoutExt}-${targetCommitHash}${fileExt}`;
      console.log(`🔍 Looking for target artifact: ${pathParts.join('-')}-${fileNameWithoutExt}-${targetCommitHash}${fileExt}`);
      
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
      const defaultDiffPath = path.join(tempOutDir, 'rsdoctor-diff.html');
      if (fs.existsSync(defaultDiffPath)) {
        try {
          await fs.promises.rename(defaultDiffPath, diffHtmlPath);
        } catch (e) {
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
    
    const isMerge = isMergeEvent();
    const isPR = isPullRequestEvent();
    
    const projectReports: ProjectReport[] = [];
    
    if (isMerge) {
      console.log('🔄 Detected merge event - uploading current branch artifacts');
      
      for (const fullPath of matchedFiles) {
        const uploadResponse = await uploadArtifact(fullPath, currentCommitHash);
        
        if (typeof uploadResponse.id !== 'number') {
          console.warn(`⚠️ Artifact upload failed for ${fullPath}`);
        } else {
          console.log(`✅ Successfully uploaded artifact with ID: ${uploadResponse.id}`);
        }
        
        // Collect project data for combined summary
        const currentBundleAnalysis = parseRsdoctorData(fullPath);
        if (currentBundleAnalysis) {
          const projectName = extractProjectName(fullPath);
          const relativePath = path.relative(process.cwd(), fullPath);
          projectReports.push({
            projectName,
            filePath: relativePath,
            current: currentBundleAnalysis,
            baseline: null
          });
        } else {
          const currentSizeData = loadSizeData(fullPath);
          if (currentSizeData) {
            // For size data, still generate individual report as it's simpler
            await generateSizeReport(currentSizeData);
          }
        }
      }
      
      // Generate combined summary for all projects in merge event
      if (projectReports.length > 0) {
        if (projectReports.length === 1) {
          // Single project: use existing report format
          const report = projectReports[0];
          if (report.current) {
            await generateBundleAnalysisReport(report.current, undefined, true, null, undefined);
          }
        } else {
          await summary.addHeading('📦 Monorepo Bundle Analysis', 2);
          
          for (const report of projectReports) {
            if (!report.current) continue;
            
            await summary.addHeading(`📁 ${report.projectName}`, 3);
            await summary.addRaw(`**Path:** \`${report.filePath}\``);
            await generateBundleAnalysisReport(report.current, undefined, false, null, undefined);
          }
          
          await summary.write();
        }
      }
      
    } else if (isPR) {
      console.log('📥 Detected pull request event - processing files');
      
      for (const fullPath of matchedFiles) {
        const report = await processSingleFile(fullPath, currentCommitHash, targetCommitHash);
        projectReports.push(report);
      }
      
      if (projectReports.length > 0) {
        if (projectReports.length === 1) {
          const report = projectReports[0];
          if (report.current) {
            await generateBundleAnalysisReport(report.current, report.baseline || undefined, true, report.baselineCommitHash, report.baselinePRs);
          }
        } else {
          await summary.addHeading('📦 Monorepo Bundle Analysis', 2);
          
          for (const report of projectReports) {
            if (!report.current) continue;
            
            await summary.addHeading(`📁 ${report.projectName}`, 3);
            await summary.addRaw(`**Path:** \`${report.filePath}\``);

            await generateBundleAnalysisReport(report.current, report.baseline || undefined, false, report.baselineCommitHash, report.baselinePRs);
          }
          
          await summary.write();
        }
      }
    }
    
    // Generate combined PR comment for all projects
    if (isPR && projectReports.length > 0) {
      const { context } = require('@actions/github');
      
      let commentBody = '## Rsdoctor Bundle Diff Analysis\n\n';
      
      if (projectReports.length > 1) {
        commentBody += `Found ${projectReports.length} project(s) in monorepo.\n\n`;
      }
      
      for (const report of projectReports) {
        if (!report.current) continue;
        
        commentBody += generateProjectMarkdown(report.projectName, report.filePath, report.current, report.baseline || undefined, report.baselineCommitHash, report.baselinePRs);
        
        // Add diff HTML link if available
        if (report.diffHtmlArtifactId) {
          const artifactDownloadLink = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/artifacts/${report.diffHtmlArtifactId}`;
          commentBody += `\n📦 **Download Diff Report**: [${report.projectName} Bundle Diff](${artifactDownloadLink})\n\n`;
        }
      }
      
      commentBody += '*Generated by [Rsdoctor GitHub Action](https://rsdoctor.rs/zh/guide/start/action)*';
      
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
    
    if (!isMerge && !isPR) {
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
