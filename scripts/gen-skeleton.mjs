#!/usr/bin/env node
// 数据包 → 骨架文件。唯一职责：按 manifest 渲染可 lint 的空实现，不做业务判断。
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const Param = z.object({ name: z.string().min(1), type: z.string().optional(), desc: z.string().optional() });
const Member = z.object({
  kind: z.enum(['method', 'getter', 'function', 'constructor']).default('method'),
  name: z.string().min(1),
  static: z.boolean().default(false),
  async: z.boolean().default(false),
  desc: z.string().optional(),
  params: z.array(Param).default([]),
  returns: z.object({ type: z.string(), desc: z.string().optional() }).optional(),
  throwsCodes: z.array(z.string()).default([]),
  invariants: z.array(z.string()).default([]),
});
const FileSpec = z.object({
  path: z.string().min(1),
  batch: z.string().regex(/^B\d+[ab]?$/),
  layer: z.string().min(1),
  kind: z.enum(['class', 'function', 'module']),
  exportName: z.string().min(1),
  classDoc: z.string().default(''),
  imports: z
    .array(
      z.object({
        from: z.string(),
        names: z.array(z.string()).default([]),
        as: z.enum(['runtime', 'type', 'genericType']).default('runtime'),
      }),
    )
    .default([]),
  members: z.array(Member).default([]),
  body: z.string().optional(),
});
const Manifest = z.object({ schemaVersion: z.literal('1'), files: z.array(FileSpec) });

const ok = (value) => ({ ok: true, value });
const err = (message) => ({ ok: false, error: { message } });

async function loadManifest(target) {
  const isDir = (await stat(target)).isDirectory();
  const paths = isDir
    ? (await readdir(target)).filter((f) => f.endsWith('.json')).map((f) => path.join(target, f))
    : [target];
  const all = [];
  for (const p of paths) {
    const raw = JSON.parse(await readFile(p, 'utf8'));
    const parsed = Manifest.safeParse(raw);
    if (!parsed.success) return err(`${p}: ${parsed.error.issues[0]?.message}`);
    all.push(...parsed.data.files.map((f) => ({ ...f, _from: p })));
  }
  const dupes = all.filter((f, i) => all.findIndex((o) => o.path === f.path) !== i).map((f) => f.path);
  if (dupes.length) return err(`duplicate file path in manifest: ${dupes[0]}`);
  return ok({ schemaVersion: '1', files: all });
}

function relImport(fromAbs, toAbs) {
  const rel = path.relative(path.dirname(fromAbs), toAbs).replace(/\.js$/, '.js');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function jsdoc(lines, indent) {
  if (!lines.length) return '';
  return [`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`), `${indent} */`].join('\n') + '\n';
}

function renderMember(f, m) {
  const doc = [];
  if (m.desc) doc.push(m.desc);
  for (const p of m.params) doc.push(`@param {${p.type ?? 'unknown'}} ${p.name}${p.desc ? ' ' + p.desc : ''}`);
  if (m.returns) {
    const t = m.async && !m.returns.type.startsWith('Promise<') ? `Promise<${m.returns.type}>` : m.returns.type;
    doc.push(`@returns {${t}}${m.returns.desc ? ' ' + m.returns.desc : ''}`);
  }
  for (const c of m.throwsCodes) doc.push(`@throws {AppError} ${c}`);
  for (const i of m.invariants) doc.push(`@invariant ${i}`);

  const head = [m.static ? 'static' : '', m.async ? 'async' : ''].filter(Boolean).join(' ');
  const args = m.params.map((p) => p.name).join(', ');
  const sig = m.kind === 'getter' ? `get ${m.name}()` : `${head ? head + ' ' : ''}${m.name}(${args})`;
  const call = m.name === 'constructor' ? `constructor` : `${f.exportName}.${m.name}`;
  return `${jsdoc(doc, '  ')}  ${sig} {\n    throw notImplemented('${f.batch}', '${call}');\n  }\n`;
}

function renderFile(f, root) {
  const abs = path.join(root, f.path);
  const errorsAbs = path.join(root, 'src/libs/utils/errors.js');
  const lines = [`// @generated-skeleton ${f.batch} — 由 gen-skeleton 渲染，填充时删除本行`];

  const imps = [];
  const typeDefs = [];
  for (const i of f.imports) {
    if (i.as === 'type') {
      // 纯类型没有运行时导出：只能走 @typedef import，避免 ESM 链接期 SyntaxError
      for (const n of i.names) typeDefs.push(`/** @typedef {import('${i.from}').${n}} ${n} */`);
    } else if (i.as === 'genericType') {
      for (const n of i.names) typeDefs.push(`/** @template T @typedef {import('${i.from}').${n}<T>} ${n} */`);
    } else if (i.names.length) {
      imps.push(`import { ${i.names.join(', ')} } from '${i.from}';`);
    } else {
      imps.push(`import '${i.from}';`);
    }
  }
  const needsStub = f.members.length > 0 && !f.imports.some((i) => i.as === 'runtime' && i.names.includes('notImplemented'));
  if (needsStub) imps.push(`import { notImplemented } from '${relImport(abs, errorsAbs)}';`);
  lines.push(`/* eslint-disable no-unused-vars -- 骨架占位；填肉时与首行一起删除 */`);
  lines.push(...typeDefs, ...imps, '');

  if (f.body) {
    lines.push(f.body.trimEnd());
  } else if (f.kind === 'class') {
    lines.push(jsdoc(f.classDoc ? [f.classDoc] : [], '').trimEnd());
    lines.push(`export class ${f.exportName} {`);
    lines.push(f.members.map((m) => renderMember(f, m)).join('\n').trimEnd() || '  // TODO');
    lines.push('}');
  } else if (f.kind === 'function') {
    lines.push(`export function ${f.exportName}() {\n  throw notImplemented('${f.batch}', '${f.exportName}');\n}`);
  } else {
    lines.push(`export const ${f.exportName} = Object.freeze({});`);
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

async function writeAll(manifest, { root, batch, force }) {
  const written = [];
  const skipped = [];
  for (const f of manifest.files) {
    if (batch && f.batch !== batch) continue;
    const abs = path.join(root, f.path);
    if (existsSync(abs)) {
      const head = (await readFile(abs, 'utf8')).split('\n', 1)[0];
      const generated = head.includes('@generated-skeleton');
      if (!generated) {
        skipped.push({ path: f.path, code: 'human-owned' });
        continue;
      }
      if (!force) {
        skipped.push({ path: f.path, code: 'exists-generated' });
        continue;
      }
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, renderFile(f, root), 'utf8');
    written.push(f.path);
  }
  return ok({ written, skipped });
}

async function markProgress(file, batch, state) {
  const p = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : { updatedAt: '', batches: [] };
  const idx = p.batches.findIndex((b) => b.id === batch);
  if (idx >= 0) p.batches[idx] = { ...p.batches[idx], state };
  else p.batches.push({ id: batch, state, files: {} });
  p.updatedAt = new Date().toISOString();
  await writeFile(file, JSON.stringify(p, null, 2) + '\n', 'utf8');
  return ok({ batch, state });
}

function parseArgs(argv) {
  /** @type {{ root: string, batch: string|undefined, force: boolean, verify: boolean, mark: {batch:string,state:string}|undefined, manifest: string }} */
  const out = { root: '.', batch: undefined, force: false, verify: false, mark: undefined, manifest: 'doc/manifest' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a === '--verify') out.verify = true;
    else if (a === '--mark') out.mark = { batch: argv[++i], state: argv[++i] };
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const loaded = await loadManifest(args.manifest);
if (!loaded.ok) {
  console.error(`[gen-skeleton] manifest invalid: ${loaded.error.message}`);
  process.exit(1);
}
const manifest = loaded.value;
console.error(`[gen-skeleton] manifest ok: ${manifest.files.length} files`);

if (args.mark) {
  const r = await markProgress('doc/progress.json', args.mark.batch, args.mark.state);
  console.error(`[gen-skeleton] progress marked ${r.ok ? r.value.batch + '=' + r.value.state : r.error.message}`);
  process.exit(0); // 只打台账，不触发渲染
}
if (args.verify) {
  for (const f of manifest.files) renderFile(f, process.cwd());
  console.error('[gen-skeleton] verify ok (render only, nothing written)');
  process.exit(0);
}
const result = await writeAll(manifest, args);
if (!result.ok) {
  console.error(`[gen-skeleton] write failed: ${result.error.message}`);
  process.exit(1);
}
console.error(`[gen-skeleton] written ${result.value.written.length}, skipped ${result.value.skipped.length}`);
for (const s of result.value.skipped) console.error(`  skip ${s.path} (${s.code})`);
