// 查桌面端"窗口控制按钮"的实现：DOM 自绘 还是 系统 overlay？以及标题栏高度/配色
//
// 用法（app.asar 路径**必须外部传入**，本文件不写死任何本机路径）：
//   node tools/scan-titlebar.mjs "<DSH 安装目录>/resources/app.asar"
// 或设环境变量 DSH_ASAR。
// Windows 上通常是：%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar
import { open } from 'node:fs/promises'

const ASAR = process.argv[2] || process.env.DSH_ASAR || ''
if (ASAR === '') {
  console.error('缺少 app.asar 路径。\n用法: node tools/scan-titlebar.mjs "<DSH 安装目录>/resources/app.asar"\n或设 DSH_ASAR 环境变量。')
  process.exit(2)
}
const needles = [
  '-webkit-app-region',
  'titleBarOverlay',
  'windowControlsOverlay',
  'symbolColor',
  'titlebar-area',
  'window-controls',
  'windowControl',
  'titleBarStyle',
]
const fh = await open(ASAR, 'r')
const size = (await fh.stat()).size
const CHUNK = 8 * 1024 * 1024
const hits = new Map(needles.map((n) => [n, []]))
let carry = Buffer.alloc(0)
for (let off = 0; off < size; off += CHUNK) {
  const len = Math.min(CHUNK, size - off)
  const buf = Buffer.alloc(len)
  await fh.read(buf, 0, len, off)
  const data = Buffer.concat([carry, buf])
  const text = data.toString('latin1')
  for (const n of needles) {
    let idx = 0
    while ((idx = text.indexOf(n, idx)) !== -1) {
      if (hits.get(n).length < 6) {
        hits.get(n).push({ off: off + idx, ctx: text.slice(Math.max(0, idx - 260), idx + 300).replace(/[\x00-\x1f]+/g, ' ') })
      }
      idx += n.length
    }
  }
  carry = data.subarray(data.length - 400)
}
for (const n of needles) {
  const list = hits.get(n)
  console.log(`\n################ "${n}" 命中 ${list.length} 处`)
  for (const h of list) console.log(`  @${h.off}\n    …${h.ctx.slice(0, 460)}…`)
}
await fh.close()
