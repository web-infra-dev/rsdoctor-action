# Rsdoctor Bundle Analysis Action

A GitHub Action for comprehensive bundle size analysis and reporting using [Rsdoctor](https://github.com/web-infra-dev/rsdoctor). This action provides detailed bundle analysis, size comparisons, and interactive HTML reports for your web applications.

## Features

- 🔍 Comprehensive bundle analysis: analyze JavaScript, CSS, HTML, and other assets; compare the current bundle size against the baseline from the target branch; generate a detailed Rsdoctor HTML diff report; and automatically surface results in PR comments and the workflow summary.

## Configuration

See the step-by-step guide: [Rsdoctor Action Integration](https://rsdoctor.rs/guide/start/action).

### 1. Configure the plugin

Install the Rsdoctor plugin, enable Brief mode, and set `output.options.type: ['json']`. Example:

```typescript
// rsbuild.config.ts
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { RsdoctorRspackPlugin } from '@rsdoctor/rspack-plugin';

export default defineConfig({
  plugins: [pluginReact()],
  tools: {
    rspack: {
      plugins: [
        new RsdoctorRspackPlugin({
          disableClientServer: true,
          output: {
            mode: 'brief',
            options: {
              type: ['json'],
            }
          }
        }),
      ],
    },
  }
});
```

### 2. Configure the workflow

```yaml
- uses: web-infra-dev/rsdoctor/actions@main
  with:
    # Path to Rsdoctor JSON data file (relative to project root)
    file_path: 'dist/.rsdoctor/rsdoctor-data.json'
    
    # Target branch for comparison (defaults to main)
    target_branch: 'main'
```

### Input Parameters

| Parameter | Description | Required | Default |
|-----------|-------------|----------|---------|
| `file_path` | Path to Rsdoctor JSON data file | Yes | - |
| `target_branch` | Target branch for baseline comparison | No | `main` |

- Example

```yaml
name: Bundle Analysis

on: [pull_request, push]

jobs:
  bundle-analysis:
    runs-on: ubuntu-latest

    permissions:
      # Allow commenting on commits
      contents: write
      # Allow commenting on issues
      issues: write
      # Allow commenting on pull requests
      pull-requests: write

    steps:
      - name: Checkout
        uses: actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955 # v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Pnpm
        run: |
          npm install -g corepack@latest --force
          corepack enable

      - name: Setup Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22
          cache: 'pnpm'

      # Update npm to the latest version to enable OIDC
      - name: Update npm
        run: |
          npm install -g npm@latest

      - name: Install Dependencies and Build
        run: |
          pnpm install
          pnpm run build
      
      - name: Build with Rsdoctor
        run: npm run build
      
      - name: Bundle Analysis
        uses: web-infra-dev/rsdoctor/actions@main
        with:
          file_path: 'dist/.rsdoctor/rsdoctor-data.json'
          target_branch: 'main'
```

## Report Examples

The Action generates comprehensive reports in multiple formats:

### 📦 Bundle Analysis Report

<img
  src="https://assets.rspack.rs/others/assets/rsdoctor/github-actions-opt.png"
/>

### 📈 Interactive HTML Report

When baseline data is available, the action generates an interactive HTML diff report using Rsdoctor's built-in comparison tools. Click "Download Bundle Diff Report" to download the Rsdoctor diff and explore the details.

<img
  src="https://assets.rspack.rs/others/assets/rsdoctor/github-actions-opt.png"
/>

## Supported Build Tools

This action works with any build tool that supports Rsdoctor:

- ✅ **Rsbuild** - Native support with `@rsdoctor/rspack-plugin`
- ✅ **Webpack** - Support via `@rsdoctor/webpack-plugin`
- ✅ **Rspack** - Native support with `@rsdoctor/rspack-plugin`

## Troubleshooting

### Common Issues

**Q: Action fails with "Rsdoctor data file not found"**
- Ensure your build process generates Rsdoctor JSON data
- Check that the `file_path` points to the correct location
- Verify Rsdoctor plugin is properly configured in your build tool

**Q: No baseline data found**
- This is normal for the first run or new repositories
- The action will still generate current bundle analysis
- Baseline data will be created after the first merge to main branch



## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Related Projects

- [Rsdoctor](https://github.com/web-infra-dev/rsdoctor) - The core bundle analysis tool

## Next Steps

We're actively working on enhancing the Rsdoctor Action with the following planned features:

- **Bundle Diff Threshold Gates**: Implement configurable size increase limits that can block PR merges when bundle size exceeds predefined thresholds, helping maintain optimal performance standards.

- **Enhanced Monorepo Support**: Improve support for monorepo projects by adding workspace-aware analysis, multi-package bundle tracking, and aggregated reporting across different packages within a single repository.

## Development

```bash
# Install dependencies
pnpm install

# Build the action
pnpm run build

# Test with example project
cd examples/rsbuild-demo
pnpm install
pnpm run build
```