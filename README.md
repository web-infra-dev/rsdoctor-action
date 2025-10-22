# Rsdoctor Bundle Analysis Action

A GitHub Action for comprehensive bundle size analysis and reporting using [Rsdoctor](https://github.com/web-infra-dev/rsdoctor). This action provides detailed bundle analysis, size comparisons, and interactive HTML reports for your web applications.

## Features

- 🔍 **Comprehensive Bundle Analysis**: Detailed analysis of JavaScript, CSS, HTML, and other assets
- 📊 **Size Comparison**: Compare current bundle sizes with baseline data from target branch
- 📈 **HTML Reports**: Generate detailed Rsdoctor HTML diff reports
- 📝 **GitHub Integration**: Automatic PR comments and workflow summaries

## Configuration

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

## Usage Examples

### Complete Workflow Setup

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

### Rsbuild Integration Example

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

### Webpack Integration Example

```javascript
// webpack.config.js
const { RsdoctorWebpackPlugin } = require('@rsdoctor/webpack-plugin');

module.exports = {
  plugins: [
    new RsdoctorWebpackPlugin({
      disableClientServer: true,
      output: {
        mode: 'brief',
        options: {
          type: ['json'],
        }
      }
    }),
  ],
};
```


## Report Examples

The Action generates comprehensive reports in multiple formats:

### 📦 Bundle Analysis Report

| Metric | Current | Baseline | Change |
|--------|---------|----------|--------|
| 📊 Total Size | 100.0 MB | 99.0 MB | +1.0 MB (+1.0%) |
| 📄 JavaScript | 80.0 MB | 79.0 MB | +1.0 MB (+1.3%) |
| 🎨 CSS | 15.0 MB | 15.0 MB | 0 B (0.0%) |
| 🌐 HTML | 2.0 MB | 2.0 MB | 0 B (0.0%) |
| 📁 Other Assets | 3.0 MB | 3.0 MB | 0 B (0.0%) |

### 📈 Interactive HTML Report

When baseline data is available, the action generates an interactive HTML diff report using Rsdoctor's built-in comparison tools. This report includes:

- Visual bundle size comparisons
- Detailed asset analysis
- Chunk dependency graphs
- Downloadable as workflow artifacts

## Supported Build Tools

This action works with any build tool that supports Rsdoctor:

- ✅ **Rsbuild** - Native support with `@rsdoctor/rspack-plugin`
- ✅ **Webpack** - Support via `@rsdoctor/webpack-plugin`
- ✅ **Rspack** - Native support with `@rsdoctor/rspack-plugin`
- ✅ **Vite** - Support via `@rsdoctor/vite-plugin`
- ✅ **Custom Builds** - Any tool that generates Rsdoctor JSON data

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


### Debug Mode

Enable debug logging by setting the `ACTIONS_STEP_DEBUG` secret to `true` in your repository settings.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Related Projects

- [Rsdoctor](https://github.com/web-infra-dev/rsdoctor) - The core bundle analysis tool

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