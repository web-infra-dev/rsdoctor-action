# Rsdoctor 打包分析 GitHub Action

Rsdoctor GitHub Action，使用 [Rsdoctor](https://github.com/web-infra-dev/rsdoctor) 进行全面的打包大小分析和报告。该 Action 为您的 Web 应用程序提供详细的打包分析、大小比较和交互式 HTML 报告。

## 功能特性

详细分析 JavaScript、CSS、HTML 和其他资源，将当前打包大小与目标分支的基线数据进行比较，生成详细的 Rsdoctor HTML 差异报告，并自动在 PR 评论和工作流摘要中展示。

## 配置

详细步骤可查看文档 [Rsdoctor Action 集成](https://rsdoctor.rs/guide/start/action)。

### 1. 配置插件

安装 Rsdoctor 插件，并开启 Brief 模式和 `output.options.type: ['json']`。配置示例如下，

- Rsbuild 集成示例

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

### 2. 配置 workflow

```yaml
- uses: web-infra-dev/rsdoctor-action@main
  with:
    # Rsdoctor JSON 数据文件路径（相对于项目根目录）
    file_path: 'dist/.rsdoctor/rsdoctor-data.json'
    
    # 用于比较的目标分支（默认为 main）, 如果想用动态目标分支，而不仅仅是主分支，则可以使用 `target_branch: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.ref || github.event.repository.default_branch }}`
    target_branch: 'main' 
```

#### 输入参数

| 参数 | 描述 | 必需 | 默认值 |
|------|------|------|--------|
| `file_path` | Rsdoctor JSON 数据文件路径 | 是 | - |
| `target_branch` | 用于基线比较的目标分支 | 否 | `main` |

- `target_branch`: 如果想用动态目标分支，而不仅仅是主分支，则可以使用 `target_branch: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.ref || github.event.repository.default_branch }}`

- 示例

```yaml
name: Bundle Analysis

on:
  pull_request:
    types: [opened, synchronize, reopened]

  push:
    branches:
      - main  # or your target branch name

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
        uses: web-infra-dev/rsdoctor-action@main
        with:
          file_path: 'dist/.rsdoctor/rsdoctor-data.json'
          target_branch: 'main'
```

## 报告示例

Action 生成多种格式的综合报告：

### 📦 打包分析报告

<img
  src="https://assets.rspack.rs/others/assets/rsdoctor/github-actions-opt.png"
/>

### 📈 交互式 HTML 报告

当基线数据可用时，Action 使用 Rsdoctor 内置的比较工具生成交互式 HTML 差异报告。点击 「Download Bundle Diff Report」可以下载 Rsdoctor 的 diff 报告，详细查看 diff 数据。

<img
  src="https://assets.rspack.rs/others/assets/rsdoctor/bundle-diff-all.png"
/>

## 支持的构建工具

此 Action 适用于任何支持 Rsdoctor 的构建工具：

- ✅ **Rsbuild** - 通过 `@rsdoctor/rspack-plugin` 原生支持
- ✅ **Webpack** - 通过 `@rsdoctor/webpack-plugin` 支持
- ✅ **Rspack** - 通过 `@rsdoctor/rspack-plugin` 原生支持

## 故障排除

### 常见问题

**Q: Action 失败，提示"未找到 Rsdoctor 数据文件"**
- 确保您的构建过程生成 Rsdoctor JSON 数据
- 检查 `file_path` 是否指向正确位置
- 验证 Rsdoctor 插件在您的构建工具中正确配置

**Q: 未找到基线数据**
- 这对于首次运行或新仓库是正常的
- Action 仍会生成当前打包分析
- 基线数据将在首次合并到主分支后创建


## 下一步计划

- 增加 Bundle Diff 阈值卡点
- Monorepo 项目更好的支持

## 贡献

我们欢迎贡献！请查看我们的[贡献指南](CONTRIBUTING.md)了解详情。

## 许可证

MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 相关项目

- [Rsdoctor](https://github.com/web-infra-dev/rsdoctor) - 核心打包分析工具

## 下一步计划

我们正在积极开发以下功能来增强 Rsdoctor Action：

- **Bundle Diff 阈值卡点**：实现可配置的大小增长限制，当打包大小超过预定义阈值时可以阻止 PR 合并，帮助维护最佳性能标准。

- **Monorepo 项目更好的支持**：通过添加工作区感知分析、多包打包跟踪以及单个仓库内不同包的聚合报告，改善对 monorepo 项目的支持。


## 开发

```bash
# 安装依赖
pnpm install

# 构建 Action
pnpm run build

# 使用示例项目测试
cd examples/rsbuild-demo
pnpm install
pnpm run build
```
