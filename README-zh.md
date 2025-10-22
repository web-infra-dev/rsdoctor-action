# Rsdoctor 打包分析 GitHub Action

Rsdoctor GitHub Action，使用 [Rsdoctor](https://github.com/web-infra-dev/rsdoctor) 进行全面的打包大小分析和报告。该 Action 为您的 Web 应用程序提供详细的打包分析、大小比较和交互式 HTML 报告。

## 功能特性

- 🔍 **全面的打包分析**：详细分析 JavaScript、CSS、HTML 和其他资源
- 📊 **大小比较**：将当前打包大小与目标分支的基线数据进行比较
- 📈 **HTML 报告**：生成详细的 Rsdoctor HTML 差异报告
- 📝 **GitHub 集成**：自动 PR 评论和工作流摘要

## 配置

```yaml
- uses: web-infra-dev/rsdoctor/actions@main
  with:
    # Rsdoctor JSON 数据文件路径（相对于项目根目录）
    file_path: 'dist/.rsdoctor/rsdoctor-data.json'
    
    # 用于比较的目标分支（默认为 main）
    target_branch: 'main'
```

### 输入参数

| 参数 | 描述 | 必需 | 默认值 |
|------|------|------|--------|
| `file_path` | Rsdoctor JSON 数据文件路径 | 是 | - |
| `target_branch` | 用于基线比较的目标分支 | 否 | `main` |

## 使用示例

### 完整工作流设置

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

### Rsbuild 集成示例

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

### Webpack 集成示例

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

### 数据结构

- **assets**：所有生成文件的数组，包含大小和关联的块信息
- **chunks**：代码块的数组，包含初始加载和大小元数据
- **size**：文件大小（字节），用于准确比较
- **path**：相对文件路径，便于识别

## 报告示例

Action 生成多种格式的综合报告：

### 📦 打包分析报告

| 指标 | 当前 | 基线 | 变化 |
|------|------|------|------|
| 📊 总大小 | 100.0 MB | 99.0 MB | +1.0 MB (+1.0%) |
| 📄 JavaScript | 80.0 MB | 79.0 MB | +1.0 MB (+1.3%) |
| 🎨 CSS | 15.0 MB | 15.0 MB | 0 B (0.0%) |
| 🌐 HTML | 2.0 MB | 2.0 MB | 0 B (0.0%) |
| 📁 其他资源 | 3.0 MB | 3.0 MB | 0 B (0.0%) |

### 📈 交互式 HTML 报告

当基线数据可用时，Action 使用 Rsdoctor 内置的比较工具生成交互式 HTML 差异报告。此报告包括：

- 可视化打包大小比较
- 详细的资源分析
- 块依赖关系图
- 可作为工作流工件下载

## 支持的构建工具

此 Action 适用于任何支持 Rsdoctor 的构建工具：

- ✅ **Rsbuild** - 通过 `@rsdoctor/rspack-plugin` 原生支持
- ✅ **Webpack** - 通过 `@rsdoctor/webpack-plugin` 支持
- ✅ **Rspack** - 通过 `@rsdoctor/rspack-plugin` 原生支持
- ✅ **Vite** - 通过 `@rsdoctor/vite-plugin` 支持
- ✅ **自定义构建** - 任何生成 Rsdoctor JSON 数据的工具

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


### 调试模式

通过在仓库设置中将 `ACTIONS_STEP_DEBUG` 密钥设置为 `true` 来启用调试日志记录。

## 贡献

我们欢迎贡献！请查看我们的[贡献指南](CONTRIBUTING.md)了解详情。

## 许可证

MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 相关项目

- [Rsdoctor](https://github.com/web-infra-dev/rsdoctor) - 核心打包分析工具

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
