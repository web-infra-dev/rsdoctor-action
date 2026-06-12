import { setFailed, getInput, summary } from '@actions/core';
import { uploadArtifact, hashPath } from './upload';
import { downloadArtifactByCommitHash } from './download';
import { GitHubService } from './github';
import { loadSizeData, generateSizeReport, parseRsdoctorData, generateBundleAnalysisReport, enrichRsdoctorDataWithGzip } from './report';
import { buildBundleDiffComment, hasBundleAnalysisChange } from './comment';
import type { BundleDiffCommentReport } from './comment';
import path from 'path';
import * as fs from 'fs';
import fg from 'fast-glob';

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

async function runRsdoctorBundleDiff(options: {
  baseline: string;
  current: string;
  html?: boolean;
  json?: boolean | string;
  output?: string;
}) {
  const { execute: executeRsdoctor } = await import(
    /* webpackChunkName: "rsdoctor-cli" */ '@rsdoctor/cli'
  );
  await executeRsdoctor('bundle-diff', options);
}

interface ProjectReport extends BundleDiffCommentReport {
  fullPath?: string;
  baselineDataPath?: string;
  diffHtmlPath?: string;
}

interface ProcessSingleFileContext {
  githubService: GitHubService;
  baselinePRs?: Array<{ number: number; title: string; url: string }>;
  aiToken?: string;
}

function parseConcurrency(value: string | undefined, defaultValue = 4): number {
  if (!value) return defaultValue;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    console.warn(`⚠️ Invalid concurrency value "${value}", using ${defaultValue}`);
    return defaultValue;
  }

  return Math.floor(parsed);
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
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
 * Process a single file: parse current data and download baseline
 */
async function processSingleFile(
  fullPath: string,
  targetCommitHash: string | null,
  baselineUsedFallback?: boolean,
  baselineLatestCommitHash?: string,
  context?: ProcessSingleFileContext,
): Promise<ProjectReport> {
  const githubService = context?.githubService || new GitHubService();
  const aiToken = context?.aiToken || '';
  const fileName = path.basename(fullPath);
  const relativePath = path.relative(process.cwd(), fullPath);
  const projectName = extractProjectName(fullPath);
  
  console.log(`\n📦 Processing project: ${projectName}`);
  console.log(`   File: ${relativePath}`);
  
  const report: ProjectReport = {
    projectName,
    filePath: relativePath,
    fullPath,
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
      const downloadResult = await downloadArtifactByCommitHash(targetCommitHash, fileName, fullPath, githubService);
      baselineJsonPath = downloadResult.filePath || path.join(downloadResult.downloadPath, fileName);
      
      console.log(`📁 Downloaded baseline file path: ${baselineJsonPath}`);
      const baselineBundleAnalysis = parseRsdoctorData(baselineJsonPath);
      if (baselineBundleAnalysis) {
        report.baseline = baselineBundleAnalysis;
        report.baselineDataPath = baselineJsonPath;
        report.baselineCommitHash = targetCommitHash;
        report.baselineUsedFallback = baselineUsedFallback;
        report.baselineLatestCommitHash = baselineLatestCommitHash;
        
        if (context?.baselinePRs) {
          baselinePRs = context.baselinePRs;
          if (baselinePRs.length > 0) {
            report.baselinePRs = baselinePRs;
          }
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

  if (aiToken && currentBundleAnalysis && report.baseline && !hasBundleAnalysisChange(currentBundleAnalysis, report.baseline)) {
    console.log(`ℹ️  No bundle changes detected for ${projectName}, skipping AI analysis`);
  }

  return report;
}

async function generateDiffArtifact(
  report: ProjectReport,
  currentCommitHash: string,
  aiToken: string,
  aiModel?: string,
): Promise<void> {
  if (!report.current || !report.baseline || !report.baselineDataPath || !report.fullPath) {
    return;
  }

  const currentBundleAnalysis = report.current;
  const tempOutDir = process.cwd();
  const safeProjectName = report.projectName.replace(/\//g, '-');
  const diffHtmlPath = path.join(tempOutDir, `rsdoctor-diff-${safeProjectName}.html`);

  console.log(`🧾 Generating bundle diff HTML for ${report.projectName}`);

  try {
    try {
      await runRsdoctorBundleDiff({
        baseline: report.baselineDataPath,
        current: report.fullPath,
        html: true,
        output: diffHtmlPath,
      });
    } catch (e) {
      console.log(`⚠️ Failed to generate rsdoctor HTML diff: ${e}`);
    }

    if (!report.diffHtmlPath) {
      report.diffHtmlPath = diffHtmlPath;
    }

    if (fs.existsSync(report.diffHtmlPath)) {
      try {
        const uploadRes = await uploadArtifact(report.diffHtmlPath, currentCommitHash);
        if (typeof uploadRes.id === 'number') {
          report.diffHtmlArtifactId = uploadRes.id;
          console.log(`✅ Uploaded bundle diff HTML for ${report.projectName}, artifact id: ${uploadRes.id}`);
        }
      } catch (e) {
        console.warn(`⚠️ Failed to upload diff html for ${report.projectName}: ${e}`);
      }
    }

    // Generate JSON diff for AI analysis (requires @rsdoctor/cli >= 1.5.6-canary.0)
    if (aiToken && hasBundleAnalysisChange(currentBundleAnalysis, report.baseline)) {
      try {
        const diffJsonPath = path.join(tempOutDir, `rsdoctor-diff-${safeProjectName}.json`);

        try {
          await runRsdoctorBundleDiff({
            baseline: report.baselineDataPath,
            current: report.fullPath,
            json: diffJsonPath,
          });
        } catch (e) {
          console.log(`⚠️ Failed to generate rsdoctor JSON diff: ${e}`);
          return;
        }

        const { analyzeWithAI } = await import(
          /* webpackChunkName: "ai-analysis" */ './ai-analysis'
        );
        report.aiAnalysis = await analyzeWithAI(diffJsonPath, aiToken, aiModel);
      } catch (e) {
        console.warn(`⚠️ Failed to generate JSON diff for AI analysis: ${e}`);
      }
    }
  } catch (e) {
    console.warn(`⚠️ rsdoctor bundle-diff failed for ${report.projectName}: ${e}`);
  }

  console.log(`✅ Finished bundle diff artifact step for ${report.projectName}`);
}

async function generateDiffArtifacts(
  projectReports: ProjectReport[],
  currentCommitHash: string,
  aiToken: string,
  aiModel?: string,
): Promise<void> {
  const reportsWithBaseline = projectReports.filter(report => report.current && report.baseline && report.baselineDataPath);
  console.log(`🧾 Generating bundle diff artifacts for ${reportsWithBaseline.length}/${projectReports.length} project(s)`);

  for (const report of reportsWithBaseline) {
    await generateDiffArtifact(report, currentCommitHash, aiToken, aiModel);
  }
}

async function publishBundleDiffComment(githubService: GitHubService, projectReports: ProjectReport[]): Promise<void> {
  const { context } = require('@actions/github');
  const reportsWithCurrent = projectReports.filter(report => report.current);

  console.log(`💬 Preparing bundle diff PR comment for ${reportsWithCurrent.length}/${projectReports.length} project(s)`);
  if (projectReports.length === 0) {
    console.log('ℹ️ No project reports collected, skipping PR comment');
    return;
  }

  const commentBody = buildBundleDiffComment(projectReports);

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

    const aiToken = process.env.AI_TOKEN || '';
    const aiModel = getInput('ai_model') || 'claude-3-5-haiku-latest';
    if (aiToken) {
      console.log(`🤖 AI analysis enabled (model: ${aiModel})`);
    }
    const concurrency = parseConcurrency(getInput('concurrency'));

    let targetCommitHash: string | null = null;
    let baselineUsedFallback = false;
    let baselineLatestCommitHash: string | undefined = undefined;
    let baselinePRs: Array<{ number: number; title: string; url: string }> | undefined;
    
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

        try {
          baselinePRs = await githubService.findPRsByCommit(targetCommitHash);
          if (baselinePRs.length > 0) {
            console.log(`📎 Found ${baselinePRs.length} PR(s) associated with baseline commit ${targetCommitHash}`);
          }
        } catch (prError) {
          console.log(`ℹ️  Could not find PRs for baseline commit: ${prError}`);
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
        enrichRsdoctorDataWithGzip(fullPath);
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

      console.log(`⚙️ Processing ${matchedFiles.length} file(s) with concurrency: ${Math.min(concurrency, matchedFiles.length)}`);
      const reports = await runWithConcurrency(matchedFiles, concurrency, (fullPath) => processSingleFile(fullPath, targetCommitHash, baselineUsedFallback, baselineLatestCommitHash, {
          githubService,
          baselinePRs,
          aiToken,
        }),
      );
      projectReports.push(...reports);
      console.log(`✅ Completed baseline processing for ${projectReports.length} project report(s)`);

      await generateDiffArtifacts(projectReports, currentCommitHash, aiToken, aiModel);
      console.log(`✅ Completed bundle diff artifact generation for ${projectReports.length} project report(s)`);

      if (isPR) {
        await publishBundleDiffComment(githubService, projectReports);
      }

      for (const fullPath of matchedFiles) {
        // For workflow_dispatch, also upload artifacts
        if (isDispatch) {
          enrichRsdoctorDataWithGzip(fullPath);
          const uploadResponse = await uploadArtifact(fullPath, currentCommitHash);
          if (typeof uploadResponse.id !== 'number') {
            console.warn(`⚠️ Artifact upload failed for ${fullPath}`);
          } else {
            console.log(`✅ Successfully uploaded artifact with ID: ${uploadResponse.id}`);
          }
        }
      }
      
      if (projectReports.length > 0) {
        console.log(`📝 Writing bundle analysis summary for ${projectReports.length} project report(s)`);
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
