const { readdirSync } = require('node:fs');
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');

module.exports = function (source) {
  const req = createRequire(this.resourcePath);
  const root = dirname(req.resolve('caniuse-lite/package.json'));
  const regions = readdirSync(join(root, 'data/regions'))
    .filter((file) => file.endsWith('.js'))
    .map((file, i) => [file.slice(0, -3), `__region${i}`]);
  const replacements = [
    [
      /__rspack_createRequire_require\("caniuse-lite\/dist\/unpacker\/agents"\)\.agents/g,
      '__caniuse.agents',
    ],
    [
      /__rspack_createRequire_require\("caniuse-lite\/dist\/unpacker\/feature"\)\.default/g,
      '__caniuse.feature',
    ],
    [
      /__rspack_createRequire_require\("caniuse-lite\/dist\/unpacker\/region"\)\.default/g,
      '__caniuse.region',
    ],
    [
      /require\('caniuse-lite\/data\/features\/' \+ name \+ '\.js'\)/g,
      '__features[name]',
    ],
    [
      /require\('caniuse-lite\/data\/regions\/' \+ code \+ '\.js'\)/g,
      '__regions[code]',
    ],
  ];
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(source))
      throw new Error(`Unexpected Rsdoctor caniuse reference: ${pattern}`);
    source = source.replace(pattern, replacement);
  }
  const imports = [
    "import * as __caniuse from 'caniuse-lite';",
    "import __features from 'caniuse-lite/data/features.js';",
    ...regions.map(
      ([name, id]) =>
        `import ${id} from 'caniuse-lite/data/regions/${name}.js';`,
    ),
    `const __regions={${regions.map(([name, id]) => `${JSON.stringify(name)}:${id}`).join(',')}};`,
  ];
  return `${imports.join('\n')}\n${source}`;
};
