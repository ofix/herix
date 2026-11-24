#!/usr/bin/env node
// 源码 → 签名快照（只含签名，绝不含实现体）。上下文预算的唯一跨批通道。
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv.find((a) => a.startsWith('--root='))?.split('=')[1] ?? argOf('--root', 'src');
const progressPath = argOf('--progress', 'doc/progress.json');
const outPath = argOf('--out', 'doc/api-surface.md');

function argOf(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

function layerOf(rel) {
  const parts = rel.split('/'); // rel 相对 --root（即 src）
  if (parts[0] === 'libs') return `libs/${parts[1]}`;
  if (parts[0] === 'main') {
    const dirs = parts.slice(1, -1);
    return dirs.length ? `main/${dirs.join('/')}` : 'main';
  }
  if (parts[0] === 'workers') return `workers/${parts[1]}`;
  if (parts[0] === 'preload') return 'preload';
  if (parts[0] === 'renderer') return 'renderer';
  return 'other';
}

function describe(block) {
  const m = block.match(/\/\*\*\n\s*\*\s*(?!@)(.+)/);
  return m ? m[1].trim() : '';
}

function extract(rel, src) {
  const skeleton = /throw notImplemented\(/.test(src);
  const exported = [];
  const reExport = /export (?:default )?(class|function|const)\s+(\w+)/g;
  for (const m of src.matchAll(reExport)) {
    const [, kind, name] = m;
    const start = m.index;
    const blockStart = src.lastIndexOf('\n\n', start);
    const head = src.slice(Math.max(0, blockStart), start);
    const members = [];
    if (kind === 'class') {
      const classBody = src.slice(start, src.indexOf('\n}\n', start) + 1 || src.length);
      for (const mm of classBody.matchAll(/^\s{2}(?:static\s+)?(?:async\s+)?(?!constructor|if|for|while|switch|catch)(\w+)\s*\(([^)]*)\)\s*\{/gm)) {
        members.push(`${mm[1]}(${mm[2].replace(/\s+/g, ' ').trim()})`);
      }
    }
    exported.push({ kind, name, desc: describe(head), members });
  }
  return { rel, layer: layerOf(rel), skeleton, exported };
}

const files = (await readdir(root, { recursive: true })).filter((f) => f.endsWith('.js')).sort();
const surfaces = [];
for (const rel of files) {
  const src = await readFile(path.join(root, rel), 'utf8');
  const s = extract(rel.replace(/\\/g, '/'), src);
  if (s.exported.length) surfaces.push(s);
}

const progress = await readFile(progressPath, 'utf8').then(JSON.parse).catch(() => ({ batches: [] }));
const byLayer = new Map();
for (const s of surfaces) {
  if (!byLayer.has(s.layer)) byLayer.set(s.layer, []);
  byLayer.get(s.layer).push(s);
}

const total = surfaces.length;
const done = surfaces.filter((s) => !s.skeleton).length;
const md = [
  '# HERIX API Surface（生成物，勿手改）',
  '',
  `> 由 \`scripts/gen-api-surface.mjs\` 生成。文件 ${total} 个，已实现 ${done} 个，骨架 ${total - done} 个。`,
  `> 进度台账：${progress.batches.map((b) => `${b.id}:${b.state}`).join(' · ') || '（空）'}`,
  '',
];
for (const [layer, items] of [...byLayer.entries()]) {
  md.push(`## ${layer}`, '', '| 文件 | 导出 | 成员（签名） | 状态 |', '|---|---|---|---|');
  for (const s of items) {
    for (const e of s.exported) {
      md.push(
        `| \`${s.rel}\` | ${e.kind} **${e.name}** | ${e.members.join('<br>') || '—'} | ${s.skeleton ? 'skeleton' : 'impl'} |`,
      );
    }
  }
  md.push('');
}
await writeFile(outPath, md.join('\n'), 'utf8');
console.error(`[gen-api-surface] ${total} files → ${outPath} (impl ${done} / skeleton ${total - done})`);
