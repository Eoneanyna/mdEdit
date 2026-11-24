import { describe, expect, it } from 'vitest'
import { isPathInside } from './path'

describe('文件路径归属判断', () => {
  it('Windows 与 POSIX 分隔符都能识别', () => {
    expect(isPathInside('D:\\docs\\project', 'D:\\docs\\project\\a.md')).toBe(true)
    expect(isPathInside('D:/docs/project', 'D:/docs/project/a.md')).toBe(true)
    expect(isPathInside('D:\\docs\\project', 'D:/docs/project/a.md')).toBe(true)
  })

  it('Windows 下盘符与目录名大小写不敏感', () => {
    expect(isPathInside('D:/Docs/Project', 'd:\\docs\\project\\A.MD')).toBe(true)
  })

  it('只比较目录层级,不会被同名前缀骗过', () => {
    expect(isPathInside('D:/docs/project', 'D:/docs/project-other/a.md')).toBe(false)
  })

  it('文件在其他目录或尚无工作区时返回 false', () => {
    expect(isPathInside('D:/docs/project', 'E:/other/a.md')).toBe(false)
    expect(isPathInside(null, 'D:/docs/project/a.md')).toBe(false)
  })
})
