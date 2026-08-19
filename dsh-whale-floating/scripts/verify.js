#!/usr/bin/env node
// dsh-whale-floating 自检：验证包结构与关键文件
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
let fails = 0;
const ok = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) fails++;
};

console.log('dsh-whale-floating 自检：');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
ok(pkg.name === 'dsh-whale-floating', '包名 dsh-whale-floating');
ok(pkg.license === 'MIT', 'MIT 协议');
ok(pkg.main === 'src/index.js', 'host 入口 src/index.js');
ok(pkg.exports && pkg.exports['./client'] === './src/client.js', 'client 导出声明');
ok(pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web', 'dsh.client.web 声明');
ok(Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.length > 0, 'client inject 依赖');

for (const f of ['src/index.js', 'src/client.js', 'desktop/main.js', 'desktop/floating.html',
  'desktop/floating-preload.js', 'desktop/assets/whale-dock.png', 'desktop/assets/whale-512.png',
  'desktop/assets/whale-180.png', 'scripts/apply-desktop-patch.js', 'README.md', 'LICENSE', 'CHANGELOG.md']) {
  ok(fs.existsSync(path.join(root, f)), '存在 ' + f);
}

// 语法
const { spawnSync } = require('node:child_process');
for (const f of ['src/index.js', 'src/client.js', 'desktop/floating-preload.js', 'scripts/apply-desktop-patch.js', 'scripts/verify.js']) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, f)]);
  ok(r.status === 0, '语法 ' + f);
}

console.log(fails === 0 ? '\n全部通过 ✅' : '\n' + fails + ' 项未通过 ❌');
process.exit(fails === 0 ? 0 : 1);
