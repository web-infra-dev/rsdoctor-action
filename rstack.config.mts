// Configuration guide: https://rstack.rs/config
import { define } from 'rstack';

define.lib({
  lib: [
    {
      bundle: true,
      dts: false,
      format: 'cjs',
      output: {
        cleanDistPath: true,
        externals: ['@rsdoctor/client'],
        legalComments: 'none',
        minify: {
          css: false,
          js: true,
          jsOptions: {
            extractComments: false,
            test: /\.[cm]?jsx?(\?.*)?$/,
            minimizerOptions: {
              compress: {
                defaults: true,
                dead_code: true,
                passes: 2,
                toplevel: true,
                unused: true,
              },
              format: {
                comments: false,
                preserve_annotations: true,
              },
              mangle: true,
              minify: true,
            },
          },
        },
      },
      tools: {
        rspack: {
          resolve: {
            alias: {
              bufferutil: false,
              'utf-8-validate': false,
            },
          },
          optimization: {
            splitChunks: {
              chunks: 'async',
              cacheGroups: {
                aiVendor: {
                  test: /[\\/]node_modules[\\/](?:\.pnpm[\\/])?(?:@ai-sdk[+\\/]|ai@|ai[\\/])/,
                  name: 'ai-vendor',
                  chunks: 'async',
                  enforce: true,
                  priority: 20,
                },
              },
            },
          },
        },
      },
    },
  ],
});

define.test({
  // Keep unit tests independent of the production bundle configuration.
  extends: {},
  testEnvironment: 'node',
  include: ['src/**/__tests__/**/*.test.ts'],
  setupFiles: ['./src/__tests__/setup.ts'],
  coverage: {
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.d.ts', 'src/**/__tests__/**'],
    thresholds: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
});

define.lint(({ js, ts }) => [
  {
    ignores: ['dist/**', 'examples/**'],
  },
  js.configs.recommended,
  ts.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'prefer-const': 'off',
      // Preserve the lint baseline before upgrading Rslint.
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  },
]);

define.fmt({
  singleQuote: true,
  sortPackageJson: true,
  ignorePatterns: ['dist/**', 'examples/**'],
});

define.staged({
  '*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}': ['rs lint', 'rs fmt'],
  '*.{json,md,mdx,css,scss,less,html,yml,yaml}': 'rs fmt',
});
