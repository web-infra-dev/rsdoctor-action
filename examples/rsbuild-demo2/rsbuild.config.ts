import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { RsdoctorRspackPlugin } from '@rsdoctor/core';

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
