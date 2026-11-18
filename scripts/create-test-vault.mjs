import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const target=process.argv[2];
if(!target)throw new Error('新しいテスト保管庫のパスを指定してください。');
const dest=resolve(target),project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(dest); // Intentionally fails if destination already exists.
await mkdir(join(dest,'.obsidian','plugins','obsidian-ai-drive-sync'),{recursive:true});
for(const name of ['main.js','manifest.json'])await copyFile(join(project,name),join(dest,'.obsidian','plugins','obsidian-ai-drive-sync',name));
await mkdir(join(dest,'notes'));await mkdir(join(dest,'attachments'));
await writeFile(join(dest,'notes','テスト.md'),'# 同期テスト\n\nAI-DRIVE-CONTENT-TEST-2026\n\nこれは実保管庫ではありません。\n');
await writeFile(join(dest,'attachments','exactly-1MB.bin'),new Uint8Array(1024*1024));
await writeFile(join(dest,'attachments','small.bin'),new Uint8Array([0,1,2,127,128,255]));
await writeFile(join(dest,'README.md'),'# テスト専用保管庫\n\nプラグインを手動で有効化し、専用Google Driveフォルダだけに接続してください。\n');
console.log('新しいテスト保管庫を作成しました: '+dest);
