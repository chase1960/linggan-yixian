import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

const config=fs.readFileSync('wrangler.toml','utf8');
if(config.includes('REPLACE_WITH_D1_DATABASE_ID')){
 console.error('请先把 wrangler.toml 里的 database_id 换成真实 D1 ID（见 docs/platform-v5.md）。');
 process.exit(1);
}
execFileSync('node',['scripts/build.mjs'],{stdio:'inherit'});
execFileSync('npx',['wrangler','deploy'],{stdio:'inherit',shell:process.platform==='win32'});
console.log('部署完成。运行 npm run check 验证 /api/health。');
