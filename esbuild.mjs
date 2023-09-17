import * as esbuild from 'esbuild';

const options = {
  entryPoints: [
    'src/Spreadsheet.js',
    'src/proxify.ts',
    'src/unboxed.js',
  ],
  bundle: true,
  format: 'esm',
  logLevel: 'info',
  minify: true,
  outdir: 'dist',
  sourcemap: true,
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  esbuild.build(options);
}