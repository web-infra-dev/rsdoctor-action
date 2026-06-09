import { defineConfig } from '@rslib/core';

export default defineConfig({
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
