// 单文件打包脚本 - 把所有依赖打包进一个 index.bundle.js
const esbuild = require('esbuild');

async function build() {
  await esbuild.build({
    entryPoints: ['./src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: './dist/index.bundle.js',
    external: [], // 空数组表示所有依赖都打包进去
    sourcemap: true,
  });
  console.log('Bundle created: dist/index.bundle.js');
}

build().catch(console.error);
