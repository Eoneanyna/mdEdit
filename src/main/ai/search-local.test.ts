// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { searchLocalMd } from './search-local'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true }))); dirs.length = 0 })
it('searches unsegmented Chinese, sees edits, and finds a better match after early files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mdedit-search-')); dirs.push(root)
  for (let i = 0; i < 22; i++) await writeFile(join(root, 'a' + i + '.md'), '休假一般规定')
  const target = join(root, 'z.markdown')
  await writeFile(target, '休假申请流程：提交主管审批，提前三天申请。')
  await mkdir(join(root, '.private'))
  await writeFile(join(root, '.private', 'secret.md'), '休假申请流程休假申请流程')
  const results = await searchLocalMd('休假申请流程怎么走', root, 1)
  expect(results[0].path).toBe(target)
  await writeFile(target, '休假申请流程：现在提前五天申请。')
  expect((await searchLocalMd('休假申请流程怎么走', root, 1))[0].snippet).toContain('提前五天')
  expect(await searchLocalMd('不存在的火星制度', root)).toEqual([])
})
