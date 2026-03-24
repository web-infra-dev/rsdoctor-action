import { setFailed, getInput, summary } from '@actions/core';
import { uploadArtifact, hashPath } from './upload';
import { downloadArtifactByCommitHash } from './download';
import { GitHubService } from './github';
import { loadSizeData, generateSizeReport, parseRsdoctorData, generateBundleAnalysisReport, BundleAnalysis, generateProjectMarkdown, formatBytes, calculateDiff } from './report';
import path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { spawnSync } from 'child_process';
import fg from 'fast-glob';
const execFileAsync = promisify(execFile);

function isPullRequestEvent(): boolean {
  const { context } = require('@actions/github');
  const isPR = context.eventName === 'pull_request';

  if (isPR) {
    const prAction = context.payload.action;
    const prMerged = context.payload.pull_request?.merged;
    const prNumber = context.payload.pull_request?.number;
    const baseRef = context.payload.pull_request?.base?.ref;
    const headRef = context.payload.pull_request?.head?.ref;

    // Skip if PR is closed (whether merged or not) - upload happens on push event after merge
    if (prAction === 'closed') {
      if (prMerged === true) {
        console.log(`ℹ️  PR is closed and merged - upload will happen on push event`);
      } else {
        console.log(`ℹ️  PR is closed but not merged - skipping processing`);
      }
      return false;
    }

    console.log(`📥 Detected pull request event`);
    console.log(`   Action: ${prAction}`);
    console.log(`   PR #${prNumber}: ${headRef} -> ${baseRef}`);
    console.log(`   Merged: ${prMerged}`);
    console.log(`   This is a PR review/update event - comparing with baseline (no upload)`);
  }

  return isPR;
}

function isPushEvent(): boolean {
  const { context } = require('@actions/github');
  const isPush = context.eventName === 'push';
  
  if (isPush) {
    const ref = context.ref;
    const targetBranch = getInput('target_branch') || 'main';
    const targetBranchRef = `refs/heads/${targetBranch}`;
    
    // Check if this push is to the target branch (main/master)
    if (ref === targetBranchRef) {
      console.log(`🔄 Detected push event to ${targetBranch} branch`);
      console.log(`   This may be a merge commit - will upload artifacts`);
      return true;
    } else {
      console.log(`ℹ️  Push event detected but not to target branch (${targetBranch})`);
      console.log(`   Current ref: ${ref}`);
      return false;
    }
  }
  
  return false;
}

function isWorkflowDispatchEvent(): boolean {
  const { context } = require('@actions/github');
  const isDispatch = context.eventName === 'workflow_dispatch';
  
  if (isDispatch) {
    console.log(`🔧 Detected workflow_dispatch event`);
    console.log(`   This is a manually triggered workflow`);
    return true;
  }
  
  return false;
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
  baselineUsedFallback?: boolean;
  baselineLatestCommitHash?: string;
}

export function extractProjectName(filePath: string): string {
  const relativePath = path.relative(process.cwd(), filePath);
  const pathParts = relativePath.split(path.sep);
  
  const buildOutputDirs = ['dist', '.rsdoctor', 'output', '.next', 'public'];
  
  const monorepoPatterns = ['packages', 'apps', 'projects', 'libs', 'modules', 'examples'];
  const patternIndex = pathParts.findIndex(part => monorepoPatterns.includes(part));
  
  if (patternIndex >= 0 && patternIndex + 1 < pathParts.length) {
    let packageName: string | null = null;
    let packageNameIndex = -1;
    for (let i = patternIndex + 1; i < pathParts.length; i++) {
      if (!buildOutputDirs.includes(pathParts[i])) {
        packageName = pathParts[i];
        packageNameIndex = i;
        break;
      }
    }

    if (packageName) {
      for (let i = pathParts.length - 2; i > packageNameIndex; i--) {
        const part = pathParts[i];
        if (!buildOutputDirs.includes(part)) {
          return `${packageName}/${part}`;
        }
      }
      return packageName;
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
  baselineUsedFallback?: boolean,
  baselineLatestCommitHash?: string,
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
        report.baselineUsedFallback = baselineUsedFallback;
        report.baselineLatestCommitHash = baselineLatestCommitHash;
        
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

      const safeProjectName = projectName.replace(/\//g, '-');
      const diffHtmlPath = path.join(tempOutDir, `rsdoctor-diff-${safeProjectName}.html`);
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
    let baselineUsedFallback = false;
    let baselineLatestCommitHash: string | undefined = undefined;
    
    const isPush = isPushEvent();
    const isPR = isPullRequestEvent();
    const isDispatch = isWorkflowDispatchEvent();
    
    // For PR and workflow_dispatch, try to get baseline for comparison
    if (isPR || isDispatch) {
      try {
        console.log('🔍 Getting target branch commit hash...');
        const commitInfo = await githubService.getTargetBranchLatestCommit();
        targetCommitHash = commitInfo.commitHash;
        baselineUsedFallback = commitInfo.usedFallbackCommit;
        baselineLatestCommitHash = commitInfo.latestCommitHash;
        console.log(`✅ Target branch commit hash: ${targetCommitHash}`);
        if (baselineUsedFallback && baselineLatestCommitHash) {
          console.log(`⚠️  Using fallback commit: ${targetCommitHash} (latest: ${baselineLatestCommitHash})`);
        }
      } catch (error) {
        console.error(`❌ Failed to get target branch commit: ${error}`);
        console.log('📝 No baseline data available for comparison');
      }
    }
    
    const projectReports: ProjectReport[] = [];
    
    if (isPush) {
      console.log('🔄 Detected push event to target branch - uploading artifacts');
      
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
      
      // Generate combined summary for all projects in push event
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
      
    } else if (isDispatch || isPR) {
      if (isDispatch) {
        console.log('🔧 Processing workflow_dispatch event - uploading artifacts and comparing with baseline');
      } else {
        console.log('📥 Detected pull request event - processing files');
      }
      
      for (const fullPath of matchedFiles) {
        const report = await processSingleFile(fullPath, currentCommitHash, targetCommitHash, baselineUsedFallback, baselineLatestCommitHash);
        projectReports.push(report);
        
        // For workflow_dispatch, also upload artifacts
        if (isDispatch) {
          const uploadResponse = await uploadArtifact(fullPath, currentCommitHash);
          if (typeof uploadResponse.id !== 'number') {
            console.warn(`⚠️ Artifact upload failed for ${fullPath}`);
          } else {
            console.log(`✅ Successfully uploaded artifact with ID: ${uploadResponse.id}`);
          }
        }
      }
      
      if (projectReports.length > 0) {
        if (projectReports.length === 1) {
          const report = projectReports[0];
          if (report.current) {
            // Add fallback notice if applicable
            if (report.baselineUsedFallback && report.baselineLatestCommitHash) {
              await summary.addRaw(`> ⚠️ **Note:** The latest commit (\`${report.baselineLatestCommitHash}\`) does not have baseline artifacts. Using commit \`${report.baselineCommitHash}\` for baseline comparison instead. If this seems incorrect, please wait a few minutes and try rerunning the workflow.\n\n`);
            }
            await generateBundleAnalysisReport(report.current, report.baseline || undefined, true, report.baselineCommitHash, report.baselinePRs);
          }
        } else {
          await summary.addHeading('📦 Monorepo Bundle Analysis', 2);
          
          // Add fallback notice if applicable (check first report)
          const firstReport = projectReports.find(r => r.current);
          if (firstReport?.baselineUsedFallback && firstReport?.baselineLatestCommitHash) {
            await summary.addRaw(`> ⚠️ **Note:** The latest commit (\`${firstReport.baselineLatestCommitHash}\`) does not have baseline artifacts. Using commit \`${firstReport.baselineCommitHash}\` for baseline comparison instead. If this seems incorrect, please wait a few minutes and try rerunning the workflow.\n\n`);
          }
          
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
      
      // Add fallback notice if applicable (check first report)
      const firstReport = projectReports.find(r => r.current);
      if (firstReport?.baselineUsedFallback && firstReport?.baselineLatestCommitHash) {
        commentBody += `> ⚠️ **Note:** The latest commit (\`${firstReport.baselineLatestCommitHash}\`) does not have baseline artifacts. Using commit \`${firstReport.baselineCommitHash}\` for baseline comparison instead. If this seems incorrect, please wait a few minutes and try rerunning the workflow.\n\n`;
      }
      
      // Generate summary (always visible)
      const reportsWithCurrent = projectReports.filter(r => r.current);
      if (reportsWithCurrent.length > 1) {
        // Count projects with changes
        let projectsWithChanges = 0;
        for (const report of reportsWithCurrent) {
          if (!report.current) continue;
          if (!report.baseline) {
            projectsWithChanges++;
            continue;
          }
          const currentSize = report.current.totalSize;
          const baselineSize = report.baseline.totalSize;
          if (baselineSize === 0 || isNaN(baselineSize)) continue;
          const diff = currentSize - baselineSize;
          if (diff !== 0) {
            projectsWithChanges++;
          }
        }
        
        const totalProjects = reportsWithCurrent.length;
        const projectWord = totalProjects === 1 ? 'project' : 'projects';
        const changeWord = projectsWithChanges === 1 ? 'project' : 'projects';
        commentBody += `Found ${totalProjects} ${projectWord} in monorepo, ${projectsWithChanges} ${changeWord} with changes.\n\n`;
      }
      
      // Generate summary table for quick overview
      if (reportsWithCurrent.length > 0) {
        // Check if any project has changes (any non-zero change)
        let hasChanges = false;
        for (const report of reportsWithCurrent) {
          if (!report.current) continue;
          if (!report.baseline) {
            hasChanges = true; // No baseline means we can't compare, show it
            break;
          }
          const currentSize = report.current.totalSize;
          const baselineSize = report.baseline.totalSize;
          if (baselineSize === 0 || isNaN(baselineSize)) continue;
          const diff = currentSize - baselineSize;
          // Show if there's any non-zero change
          if (diff !== 0) {
            hasChanges = true;
            break;
          }
        }
        
        // Use 'open' attribute if there are changes, otherwise keep it collapsed
        const detailsTag = hasChanges ? '<details open>\n' : '<details>\n';
        commentBody += `${detailsTag}<summary><b>📊 Quick Summary</b></summary>\n\n`;
        commentBody += '| Project | Total Size | Change |\n';
        commentBody += '|---------|------------|--------|\n';
        
        for (const report of reportsWithCurrent) {
          if (!report.current) continue;
          const currentSize = report.current.totalSize;
          const baselineSize = report.baseline?.totalSize || 0;
          const diff = report.baseline ? calculateDiff(currentSize, baselineSize) : { value: '-', emoji: '' };
          const sizeStr = formatBytes(currentSize);
          commentBody += `| ${report.projectName} | ${sizeStr} | ${diff.emoji} ${diff.value} |\n`;
        }
        
        commentBody += '\n</details>\n\n';
      }
      
      // Helper function to check if a report has significant changes

      const hasSignificantChanges = (report: ProjectReport): boolean => {
        if (!report.current) return false;
        if (!report.baseline) return true; // No baseline means we can't compare, show it
        const currentSize = report.current.totalSize;
        const baselineSize = report.baseline.totalSize;
        if (baselineSize === 0 || isNaN(baselineSize)) return false;
        const diff = currentSize - baselineSize;
        // Show detailed report if there's any change (not zero)
        return diff !== 0;
      };
      
      // Filter reports with changes
      const reportsWithChanges = projectReports.filter(report => {
        if (!report.current) return false;
        return hasSignificantChanges(report);
      });
      
      // Generate detailed reports only for projects with changes
      if (reportsWithChanges.length > 0) {
        // Only add collapse wrapper if there are multiple reports with changes
          commentBody += '<details>\n<summary><b>📋 Detailed Reports</b> (Click to expand)</summary>\n\n';
        
        for (const report of reportsWithChanges) {
          commentBody += generateProjectMarkdown(report.projectName, report.filePath, report.current!, report.baseline || undefined, report.baselineCommitHash, report.baselinePRs);
          
          // Add diff HTML link if available
          if (report.diffHtmlArtifactId) {
            const artifactDownloadLink = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/artifacts/${report.diffHtmlArtifactId}`;
            commentBody += `\n📦 **Download Diff Report**: [${report.projectName} Bundle Diff](${artifactDownloadLink})\n\n`;
          }
        }
        
        if (reportsWithChanges.length > 1) {
          commentBody += '</details>\n\n';
        }
      }
      
      commentBody += '*Generated by [Rsdoctor GitHub Action](https://rsdoctor.rs/guide/start/action)*';
      
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
    
    if (!isPush && !isPR && !isDispatch) {
      console.log('ℹ️ Skipping artifact operations - this action only runs on push events (to target branch), pull requests, and workflow_dispatch');
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
