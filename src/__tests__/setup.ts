import { rstest } from "@rstest/core";

// Mock GitHub Actions environment variables
process.env.GITHUB_REPOSITORY = 'web-infra-dev/rsdoctor-action';
process.env.GITHUB_SERVER_URL = 'https://github.com';
process.env.GITHUB_RUN_ID = '12345';
process.env.GITHUB_TOKEN = 'test-token';
process.env.GITHUB_WORKSPACE = process.cwd();

// Mock GitHub Actions Core functions
rstest.mock('@actions/core', () => ({
  getInput: rstest.fn((name: string) => {
    switch (name) {
      case 'github_token':
        return process.env.GITHUB_TOKEN;
      case 'file_path':
        return 'dist/.rsdoctor/rsdoctor-data.json';
      case 'target_branch':
        return 'main';
      default:
        return '';
    }
  }),
  setFailed: rstest.fn(),
  summary: {
    addHeading: rstest.fn().mockReturnThis(),
    addTable: rstest.fn().mockReturnThis(),
    addLink: rstest.fn().mockReturnThis(),
    addSeparator: rstest.fn().mockReturnThis(),
    addRaw: rstest.fn().mockReturnThis(),
    write: rstest.fn().mockResolvedValue(undefined),
  },
}));

// Mock GitHub Actions Artifact
rstest.mock('@actions/artifact', () => ({
  DefaultArtifactClient: class {
    uploadArtifact = rstest.fn().mockResolvedValue({ id: 1 });
    downloadArtifact = rstest.fn().mockResolvedValue({ downloadPath: '/tmp/artifacts' });
  }
}));

