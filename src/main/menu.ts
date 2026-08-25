import { basename } from 'node:path'
import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions, shell } from 'electron'
import type { MenuChannel } from '@shared/ipc'
import pkg from '../../package.json'
import * as store from './store'

const isMac = process.platform === 'darwin'
const APP_NAME = 'mdEdit'
// 作者与仓库地址取自 package.json,避免两处各写一份而失同步
const REPO_URL = pkg.homepage

/**
 * 向当前聚焦的窗口派发菜单动作,由渲染进程决定具体行为。
 * 文件类操作的实现留到 M3,此处只负责把信号送达。
 */
function emit(channel: MenuChannel): void {
  BrowserWindow.getFocusedWindow()?.webContents.send(channel)
}

/** 最近打开子菜单。列表随每次读写变化,菜单需在其后重建 */
function recentSubmenu(): MenuItemConstructorOptions[] {
  const files = store.getRecentFiles()
  if (files.length === 0) return [{ label: '(暂无记录)', enabled: false }]

  return files.map((filePath) => ({
    label: basename(filePath),
    toolTip: filePath,
    click: () => {
      BrowserWindow.getFocusedWindow()?.webContents.send('menu:open-recent', filePath)
    }
  }))
}

export function buildAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{ role: 'appMenu' }] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: '文件',
      submenu: [
        { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => emit('menu:file-new') },
        { label: '打开文件…', accelerator: 'CmdOrCtrl+O', click: () => emit('menu:file-open') },
        {
          label: '打开文件夹…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => emit('menu:folder-open')
        },
        { label: '最近打开', submenu: recentSubmenu() },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => emit('menu:file-save') },
        {
          label: '另存为…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => emit('menu:file-save-as')
        },
        {
          label: '导出',
          submenu: [
            {
              label: '导出为纯文本…',
              click: () => emit('menu:export-text')
            },
            {
              label: '转换为 Markdown…',
              click: () => emit('menu:export-markdown')
            }
          ]
        },
        {
          label: '自动保存',
          type: 'checkbox',
          checked: store.getAutoSave(),
          click: () => {
            const next = !store.getAutoSave()
            store.setAutoSave(next)
            // 勾选状态存在菜单模板里,改完要重建才会更新
            buildAppMenu()
            BrowserWindow.getFocusedWindow()?.webContents.send('app:autosave-changed', next)
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '查找', accelerator: 'CmdOrCtrl+F', click: () => emit('menu:find') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '大纲', accelerator: 'CmdOrCtrl+K', click: () => emit('menu:toggle-outline') },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: `关于 ${APP_NAME}`,
          // 纯展示信息,主进程直接弹框即可,无需绕到渲染层
          click: () => {
            void (async () => {
              const { response } = await dialog.showMessageBox({
                type: 'info',
                title: `关于 ${APP_NAME}`,
                message: `${APP_NAME} ${app.getVersion()}`,
                detail: [
                  pkg.description,
                  '',
                  `作者:${pkg.author}`,
                  `仓库:${REPO_URL}`,
                  '',
                  `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`
                ].join('\n'),
                buttons: ['访问仓库', '关闭'],
                defaultId: 1,
                cancelId: 1
              })
              if (response === 0) void shell.openExternal(REPO_URL)
            })()
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
