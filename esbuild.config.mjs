import { build } from 'esbuild';
await build({entryPoints:['src/main.ts'],outfile:'main.js',bundle:true,external:['obsidian'],platform:'browser',format:'cjs',target:'es2022',logLevel:'info',sourcemap:false});
await build({entryPoints:['scripts/desktop-auth.ts'],outfile:'google-auth-helper.mjs',bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'info',sourcemap:false});
