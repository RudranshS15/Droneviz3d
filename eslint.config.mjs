import { FlatCompat } from '@eslint/eslintrc'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const compat = new FlatCompat({ baseDirectory: __dirname })

/**
 * Next.js' recommended rule set (core-web-vitals + TypeScript), which covers the
 * accessibility and correctness rules this project cares about. Generated build
 * output and the test harness are not linted.
 */
const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: [
      '.next/**',
      '.test-build/**',
      'node_modules/**',
      'next-env.d.ts',
      'grounding-worker.py',
    ],
  },
]

export default config
