// HERIX ESLint（flat config, ESLint 9）
// 目的：固化《工程规约》2.5 的依赖方向；骨架期允许占位参数未使用。

const forbidden = (group, message) => ['error', { patterns: [{ group, message }] }];

export default [
  {
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    ignores: ['node_modules/**', 'dist/**', 'release/**', 'coverage/**', 'doc/api-surface.md'],
  },

  // 通用规则（全仓）
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // 骨架期方法体只有 throw notImplemented(...)，占位参数必然"未使用"
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-undef': 'off', // 由 tsc --checkJs 兜底，避免为每个全局手写 globals
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-throw-literal': 'error',
      'no-debugger': 'error',
      'no-empty': 'error',
      'no-fallthrough': 'error',
    },
  },

  // libs 是叶子层：不得反向依赖上层
  {
    files: ['src/libs/**'],
    rules: {
      'no-restricted-imports': forbidden(
        ['**/main/**', '**/workers/**', '**/renderer/**', '**/preload/**'],
        'libs 是叶子层，禁止 import 上层（main/workers/renderer/preload）',
      ),
    },
  },

  // workers：可以 import libs，绝不可碰 main
  {
    files: ['src/workers/**'],
    rules: {
      'no-restricted-imports': forbidden(
        ['**/main/**', '**/renderer/**', '**/preload/**'],
        'worker 只允许依赖 libs/*；主进程交互必须走帧协议',
      ),
    },
  },

  // renderer：只能经 api/ 调 IPC，不得直接 import 主进程或 zod schemas（避免 zod 进 UI 包）
  {
    files: ['src/renderer/**'],
    rules: {
      'no-restricted-imports': forbidden(
        ['**/main/**', '**/preload/**', '**/libs/schemas/**'],
        'renderer 不得 import main/preload/libs-schemas；IPC 一律经 api/ 层',
      ),
    },
  },

  // preload：桥接层，只允许 libs/contracts
  {
    files: ['src/preload/**'],
    rules: {
      'no-restricted-imports': forbidden(
        ['**/main/**', '**/renderer/**', '**/libs/schemas/**'],
        'preload 只允许 libs/contracts；业务逻辑不进桥接层',
      ),
    },
  },
];
