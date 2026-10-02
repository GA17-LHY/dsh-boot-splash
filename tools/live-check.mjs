/**
 * boot-splash 在线冒烟检查（对着正在运行的桌面端宿主跑，不改任何源码）
 *
 * 用法：
 *   node tools/live-check.mjs                      # 只体检
 *   node tools/live-check.mjs --dir "D:\\videos"   # 先把素材目录写进配置，再体检
 *
 * 检查项：配置读写（含写守卫）、素材清单、素材字节（含 Range）、体检结论。
 * 全部走本机回环的宿主路由，因此顺便验证了"路由真的挂上了"。
 */
const BASE = process.env.BOOT_SPLASH_BASE || 'http://127.0.0.1:19387'
const ROUTE = '/plugins/boot-splash'

const argDir = (() => {
  const i = process.argv.indexOf('--dir')
  return i >= 0 ? process.argv[i + 1] : null
})()

let pass = 0
let fail = 0
const fails = []
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  ✓ ' + name) } else {
    fail += 1; fails.push(name)
    console.log('  ✗ ' + name + (extra === undefined ? '' : ' — ' + JSON.stringify(extra).slice(0, 300)))
  }
}

async function json(path, init) {
  const r = await fetch(BASE + ROUTE + path, { cache: 'no-store', ...init })
  const body = await r.json().catch(() => null)
  return { status: r.status, body, headers: r.headers }
}

console.log(`\n宿主：${BASE}    路由：${ROUTE}`)

// 0) 宿主半侧在不在：状态路由能不能答
console.log('\n[0] 宿主半侧活性')
const status0 = await json('/status.json')
ok('GET /status.json 应答 200', status0.status === 200, status0.body)
ok('体检字段齐全（effective/clips/problems/configPath）',
  status0.body && status0.body.effective && Array.isArray(status0.body.clips) && Array.isArray(status0.body.problems) && typeof status0.body.configPath === 'string')
ok('面板脚本可读', status0.body && status0.body.panelReadable === true)

// 1) 可选：写入素材目录
if (argDir !== null) {
  console.log('\n[1] 写入素材目录')
  const w = await json('/config.json', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-boot-splash-write': '1', origin: BASE },
    body: JSON.stringify({ dir: argDir }),
  })
  ok('本机 + 自定义头 ⇒ 写入 200', w.status === 200 && w.body && w.body.ok === true, w.body)
  ok('写回值与请求一致', w.body && w.body.effective && w.body.effective.dir === argDir, w.body && w.body.effective)

  const refused = await json('/config.json', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dir: 'x' }),
  })
  ok('缺自定义头 ⇒ 403（写守卫仍生效）', refused.status === 403)
}

// 2) 素材清单
console.log('\n[2] 素材清单')
const clips = await json('/clips.json')
ok('GET /clips.json 应答 200', clips.status === 200)
const list = (clips.body && clips.body.clips) || []
ok('素材数 > 0', list.length > 0, { count: list.length, problems: clips.body && clips.body.problems })
ok('每条都带 name/src/bytes', list.every((c) => typeof c.name === 'string' && typeof c.src === 'string' && typeof c.bytes === 'number'))
ok('src 指向 clip 路由且带 rev', list.every((c) => c.src.startsWith(ROUTE + '/clip/') && c.src.includes('?v=')))
for (const c of list) {
  console.log(`     · ${c.name}  ${(c.bytes / 1048576).toFixed(2)} MB  faststart=${c.faststart === null ? 'n/a' : c.faststart}`)
}

// 3) 素材字节：整段 + Range
console.log('\n[3] 素材字节')
if (list.length > 0) {
  const first = list[0]
  const url = BASE + first.src
  const full = await fetch(url, { cache: 'no-store' })
  ok('整段请求 200', full.status === 200)
  ok('响应头 no-store + accept-ranges', full.headers.get('cache-control') === 'no-store' && full.headers.get('accept-ranges') === 'bytes')
  ok('content-length 与清单一致', Number(full.headers.get('content-length')) === first.bytes)
  await full.arrayBuffer()

  const part = await fetch(url, { headers: { range: 'bytes=0-1023' } })
  ok('Range 请求 206', part.status === 206)
  ok('content-range 正确', /^bytes 0-1023\/\d+$/.test(part.headers.get('content-range') || ''), part.headers.get('content-range'))
  const buf = Buffer.from(await part.arrayBuffer())
  ok('Range 返回 1024 字节', buf.length === 1024)
  ok('mp4 魔数（偏移 4 起 ftyp）', buf.subarray(4, 8).toString('latin1') === 'ftyp', buf.subarray(4, 8).toString('latin1'))
}

// 4) 收尾体检
console.log('\n[4] 收尾体检')
const status = await json('/status.json')
ok('体检 ok=true', status.body && status.body.ok === true, status.body && status.body.problems)
ok('已注入（enabled=true）', status.body && status.body.injected === true)

console.log(`\n在线冒烟：通过 ${pass} / 失败 ${fail}`)
if (fail > 0) console.log('失败项：' + fails.join(' | '))
process.exit(fail === 0 ? 0 : 1)
