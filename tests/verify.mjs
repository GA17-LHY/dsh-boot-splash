/**
 * boot-splash 离线验证：不需要 DSH、不需要浏览器、不需要重启。
 *
 * 覆盖三件最容易静默失败的事：
 *  ① 配置：坏输入不抛异常、写读闭环、原子写；
 *  ② 宿主 apply：路由挂了 4 条（manifest/status/config/clip）、
 *     **开=推 2 行 / 关=推 0 行**、写接口的本地来源守卫；
 *  ③ 客户端：用桩 window.__ModuleLoader__ + 桩 react 跑一遍，确认它
 *     ①报到（clientReady）②两条通路都尝试注册。
 *
 * 用法：node tests/verify.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

// 注意：工作区路径含中文，必须用 fileURLToPath —— URL.pathname 会给出百分号编码的路径。
const ROOT = fileURLToPath(new URL('..', import.meta.url))
let pass = 0
let fail = 0
const fails = []

function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  ✓ ' + name) } else {
    fail += 1
    fails.push(name)
    console.log('  ✗ ' + name + (extra === undefined ? '' : ' — ' + JSON.stringify(extra)))
  }
}

/* --------------------------------------- ⓪c 开机面板：桩 DOM 行为回归 */

console.log('\n[⓪c] 面板行为（桩 DOM）：点一下必须真开声音')
{
  const src = readFileSync(join(ROOT, 'panel.js'), 'utf8')

  const mk = (tag) => {
    const el = {
      tagName: tag, children: [], parentNode: null, _ev: {}, attrs: {}, _text: '', _cls: '',
      style: { setProperty() {}, },
      volume: 1, readyState: 0, currentTime: 0, duration: 10, currentSrc: '',
      play() { el.played = (el.played || 0) + 1; el.readyState = 2; return Promise.resolve() },
      pause() {},
      setAttribute(k, v) { el.attrs[k] = v },
      getAttribute(k) { return el.attrs[k] },
      hasAttribute(k) { return k in el.attrs },
      appendChild(c) { el.children.push(c); c.parentNode = el; return c },
      insertBefore(c) { el.children.unshift(c); c.parentNode = el; return c },
      removeChild(c) { el.children = el.children.filter((x) => x !== c); c.parentNode = null },
      contains(other) { let p = other; while (p) { if (p === el) return true; p = p.parentNode } return false },
      addEventListener(type, fn) { el._ev[type] = fn },
      get firstChild() { return el.children[0] || null },
    }
    Object.defineProperty(el, 'className', { get: () => el._cls, set: (v) => { el._cls = v } })
    Object.defineProperty(el, 'textContent', { get: () => el._text, set: (v) => { el._text = String(v) } })
    Object.defineProperty(el, 'id', { get: () => el.attrs.id, set: (v) => { el.attrs.id = v } })
    Object.defineProperty(el, 'src', { get: () => el.attrs.src, set: (v) => { el.attrs.src = v } })
    Object.defineProperty(el, 'muted', { get: () => el.attrs.muted === true, set: (v) => { el.attrs.muted = v === true } })
    Object.defineProperty(el, 'autoplay', { get: () => false, set: () => {} })
    Object.defineProperty(el, 'playsInline', { get: () => false, set: () => {} })
    Object.defineProperty(el, 'preload', { get: () => '', set: () => {} })
    Object.defineProperty(el, 'type', { get: () => '', set: () => {} })
    return el
  }

  const documentStub = {
    documentElement: mk('html'), head: mk('head'), body: mk('body'),
    getElementById: () => null,
    createElement: (tag) => mk(tag),
  }
  const winListeners = {}
  const g = {
    __BOOT_SPLASH_CFG__: { fadeMs: 100, enterMode: 'end', holdMs: 5000, manifest: '/x/clips.json', problems: [] },
    // 桩环境补上 performance：panel.js 的诊断会读 paint 等条目，桩也据此更接近真实浏览器
    //（少了它，桩里测不出「页面已经画过」这类状态）。
    performance: { getEntriesByType: () => [{ name: 'first-contentful-paint', startTime: 1 }] },
    addEventListener(type, fn) { winListeners[type] = fn },
    setTimeout: (fn) => 0,
    setInterval: () => 0,
    clearInterval: () => {},
  }
  const logs = []
  const fetchStub = async () => ({
    ok: true, status: 200,
    json: async () => ({ clips: [{ name: 'a.mp4', src: '/plugins/boot-splash/clip/a.mp4?v=1-2', bytes: 2, faststart: true }], problems: [] }),
  })

  new Function('document', 'window', 'globalThis', 'console', 'fetch', 'getComputedStyle', 'setTimeout', 'setInterval', 'clearInterval', src)(
    documentStub, { __ModuleLoader__: { load() {} } }, g,
    { info: (m) => logs.push('info:' + m), warn: (m) => logs.push('warn:' + m) },
    fetchStub, () => ({ getPropertyValue: () => '' }), g.setTimeout, g.setInterval, g.clearInterval)

  const root = documentStub.body.children.find((c) => c._cls === 'boot-splash')
  ok('面板挂上了覆盖层', root !== undefined)
  ok('注册了全局指针监听', typeof winListeners.pointerdown === 'function')
  ok('导出了 __BOOT_SPLASH__ 接口', typeof g.__BOOT_SPLASH__ === 'object' && typeof g.__BOOT_SPLASH__.clientReady === 'function')

  await new Promise((r) => setTimeout(r, 30))          // 等 fetch/playClip 落地
  const video = root && root.children.find((c) => c.tagName === 'video')
  ok('创建了 video 且初始静音', video !== undefined && video.muted === true, video && video.muted)

  winListeners.pointerdown({})                          // 模拟"第一下点击"
  await new Promise((r) => setTimeout(r, 10))
  // 2026-10-02 真实 bug：判据误用 state.video ⇒ 这条分支永不执行、动画一直静音
  ok('【回归】第一下点击真的解除了静音', video !== undefined && video.muted === false, video && video.muted)
  ok('提示文案说明了开声音', String(g.__BOOT_SPLASH__.status().hint).length > 0, g.__BOOT_SPLASH__.status().hint)

  // 2026-10-02 用户实测的第二个现象："按了按钮响一下、随即又变成未开启"。根因是按钮上的
  // pointerdown（窗口 capture 阶段）先把声音开掉，按钮自己的 click 再把它关回去。
  // 下面把真实事件序列原样重演一遍（点在按钮上 ⇒ 全局手势应忽略 ⇒ 只有按钮切一次）。
  const ui = root.children.find((c) => c._cls === 'boot-splash-ui')
  const button = ui && ui.children.find((c) => c.attrs && c.attrs['data-bs-sound'] === '1')
  ok('存在开声音按钮（gesture 模式）', button !== undefined)
  video.muted = true                                    // 回到静音，重演序列
  winListeners.pointerdown({ target: button })           // ① 点在按钮上
  await new Promise((r) => setTimeout(r, 5))
  ok('【回归】点在按钮上时全局手势不抢跑（仍静音）', video.muted === true, video.muted)
  await button._ev.click({ target: button, stopPropagation() {}, preventDefault() {} })
  await new Promise((r) => setTimeout(r, 5))
  ok('【回归】按一下按钮 = 开声（不会被自己关回去）', video.muted === false, video.muted)
  await button._ev.click({ target: button, stopPropagation() {}, preventDefault() {} })
  await new Promise((r) => setTimeout(r, 5))
  ok('再按一下 = 静音（可来回切）', video.muted === true, video.muted)

  ok('面板没有产生告警', !logs.some((l) => l.startsWith('warn:')), logs.filter((l) => l.startsWith('warn:')))
}

/* ---------------------------------------------------------- ⓪ 语法检查 */

console.log('\n[⓪] 语法')
for (const f of ['host.js', 'panel.js', 'client.js', 'tests/verify.mjs']) {
  try {
    execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' })
    ok(f + ' 语法通过', true)
  } catch (error) {
    ok(f + ' 语法通过', false, String(error.stderr ?? error.message).slice(0, 200))
  }
}

console.log('\n[⓪b] 开机面板的静态约定（防回归）')
{
  const panel = readFileSync(join(ROOT, 'panel.js'), 'utf8')
  // Windows 的窗口按钮是系统画的 overlay（透明底 + 浅色主题下近黑图标）：全屏覆盖会把它们
  // 衬成"黑底黑图标"（用户 2026-10-02 实际报的现象）⇒ 必须让出标题栏那一条。
  ok('panel.js 让出系统标题栏（窗口按钮不变黑）',
    panel.includes('--dsh-windows-titlebar-height') && panel.includes('boot-splash-top'))
  ok('panel.js 文字在左下角（不压画面中央）', panel.includes('left:22px;bottom:18px'))
}

/* ------------------------------------------------------ ① 宿主半侧单元 */

const home = mkdtempSync(join(tmpdir(), 'boot-splash-verify-'))
process.env.DSH_HOME = home                     // 必须在 import host.js 之前设好
const videos = join(home, 'videos')
mkdirSync(videos, { recursive: true })

// 造两段假 mp4：一段 moov 在 mdat 前（已优化），一段 moov 在尾部
function fakeMp4({ faststart }) {
  const box = (type, payload) => {
    const b = Buffer.alloc(8 + payload.length)
    b.writeUInt32BE(8 + payload.length, 0)
    b.write(type, 4, 'latin1')
    payload.copy(b, 8)
    return b
  }
  const ftyp = box('ftyp', Buffer.from('isomiso2avc1mp41', 'latin1'))
  const moov = box('moov', Buffer.alloc(64))
  const mdat = box('mdat', Buffer.alloc(256))
  return faststart ? Buffer.concat([ftyp, moov, mdat]) : Buffer.concat([ftyp, mdat, moov])
}
writeFileSync(join(videos, 'ok.mp4'), fakeMp4({ faststart: true }))
writeFileSync(join(videos, 'tail.mp4'), fakeMp4({ faststart: false }))
writeFileSync(join(videos, 'note.txt'), 'not a video')

const host = await import(new URL('../host.js', import.meta.url).href)

console.log('\n[①] 配置校验（坏输入不抛、逐字段兜底）')
ok('默认值冻结且字段齐全', Object.keys(host.DEFAULTS).join(',') === 'enabled,fadeMs,enterMode,holdMs,dir,clips,sound,volume,diag,delayMs,mode,lineGapMs')
{
  const r = host.validateConfig({ enabled: 'yes', fadeMs: 1e9, enterMode: 'nope', holdMs: -1, dir: 42, clips: 'x', extra: 1 })
  ok('坏字段全部落到默认值 + 有问题清单', r.value.enabled === true && r.value.fadeMs === 2000 && r.value.enterMode === 'tail' && r.value.holdMs === 15000 && r.value.dir === '' && Array.isArray(r.value.clips))
  ok('问题清单逐条说明（含未知字段）', r.problems.length >= 6 && r.problems.some((p) => p.includes('extra')), r.problems)
}
{
  const r = host.validateConfig('not an object')
  ok('非对象输入也不抛', r.problems.length === 1 && r.value.enabled === true)
}
{
  const good = host.validateConfig({ sound: 'mute', volume: 40 })
  ok('新字段 sound/volume 正常接受', good.value.sound === 'mute' && good.value.volume === 40, good.problems)
  ok('sound 默认 gesture、volume 默认 100', host.DEFAULTS.sound === 'gesture' && host.DEFAULTS.volume === 100)
  const badSound = host.validateConfig({ sound: 'loud' })
  ok('非法 sound 落回默认并报问题', badSound.value.sound === 'gesture' && badSound.problems.some((p) => p.includes('sound')), badSound.problems)
  const badVol = host.validateConfig({ volume: 500 })
  ok('非法 volume 落回默认并报问题', badVol.value.volume === 100 && badVol.problems.some((p) => p.includes('volume')), badVol.problems)
  ok('diag 默认关（不诊断就不多发一个请求）', host.DEFAULTS.diag === false)
  const badDiag = host.validateConfig({ diag: 'yes' })
  ok('非法 diag 落回默认并报问题', badDiag.value.diag === false && badDiag.problems.some((p) => p.includes('diag')), badDiag.problems)
  const goodDiag = host.validateConfig({ diag: true })
  ok('diag:true 正常接受且不报问题', goodDiag.value.diag === true && goodDiag.problems.length === 0, goodDiag.problems)
  ok('delayMs 默认 0（默认与原行为逐字节一致）', host.DEFAULTS.delayMs === 0)
  const badDelay = host.validateConfig({ delayMs: 99999 })
  ok('非法 delayMs 落回默认并报问题', badDelay.value.delayMs === 0 && badDelay.problems.some((p) => p.includes('delayMs')), badDelay.problems)
  const goodDelay = host.validateConfig({ delayMs: 3000 })
  ok('delayMs 正常接受且不报问题', goodDelay.value.delayMs === 3000 && goodDelay.problems.length === 0, goodDelay.problems)
  ok('lineGapMs 默认 120（逐行回放节奏）', host.DEFAULTS.lineGapMs === 120)
  const badGap = host.validateConfig({ lineGapMs: 99999 })
  ok('非法 lineGapMs 落回默认并报问题', badGap.value.lineGapMs === 120 && badGap.problems.some((p) => p.includes('lineGapMs')), badGap.problems)
  const zeroGap = host.validateConfig({ lineGapMs: 0 })
  ok('lineGapMs:0 表示不节流，正常接受', zeroGap.value.lineGapMs === 0 && zeroGap.problems.length === 0, zeroGap.problems)
  ok('mode 默认 video（与前几版行为一致）', host.DEFAULTS.mode === 'video')
  const badMode = host.validateConfig({ mode: 'fancy' })
  ok('非法 mode 落回默认并报问题', badMode.value.mode === 'video' && badMode.problems.some((p) => p.includes('mode')), badMode.problems)
  const goodMode = host.validateConfig({ mode: 'status' })
  ok('mode:status 正常接受且不报问题', goodMode.value.mode === 'status' && goodMode.problems.length === 0, goodMode.problems)
}

console.log('\n[①] 参数化读/写 + 原子写')
{
  const before = host.readConfig()
  ok('没有配置文件时回落默认值且说明来源', before.exists === false && before.value.fadeMs === 2000 && before.source.includes('defaults'))

  const w = host.writeConfig({ fadeMs: 1500, enterMode: 'click' })
  ok('写成功', w.ok === true, w)
  const after = host.readConfig()
  ok('读回来与写入一致（并保留其它默认字段）', after.value.fadeMs === 1500 && after.value.enterMode === 'click' && after.value.holdMs === 15000)

  const bad = host.writeConfig({ enterMode: 'illegal' })
  ok('非法值拒绝写入且给出原因', bad.ok === false && bad.problems.some((p) => p.includes('enterMode')), bad)
  const still = host.readConfig()
  ok('拒绝后文件内容没被改坏', still.value.enterMode === 'click')

  writeFileSync(join(home, 'boot-splash.json'), '{ 这不是 JSON')
  const broken = host.readConfig()
  ok('JSON 坏掉时回落默认值并说明', broken.problems.some((p) => p.includes('JSON')), broken.problems)
}

console.log('\n[①] 素材与 faststart 判定')
{
  host.writeConfig({ dir: videos, clips: [] })
  const listed = host.listClips(videos, [])
  ok('只列视频扩展名（忽略 .txt）', listed.clips.length === 2, listed.clips.map((c) => c.name))
  ok('moov 在前的判为已优化', listed.clips.find((c) => c.name === 'ok.mp4').faststart === true)
  ok('moov 在尾部的判为未优化', listed.clips.find((c) => c.name === 'tail.mp4').faststart === false)

  const want = host.listClips(videos, ['ok.mp4', 'missing.mp4'])
  ok('显式清单生效并报告缺失项', want.clips.length === 1 && want.problems.some((p) => p.includes('missing.mp4')), want.problems)

  const none = host.listClips(join(home, 'nope'), [])
  ok('目录不存在时不抛、给出问题', none.clips.length === 0 && none.problems[0].includes('不存在'))

  const empty = host.listClips('', [])
  ok('未配置 dir ⇒ 用包内自带素材（没有才退渐变底）',
    empty.clips.length > 0 || String(empty.problems[0]).includes('渐变底'), empty.problems)
  ok('resolveClipsDir：配置优先于自带素材', host.resolveClipsDir('D:/nope') !== host.resolveClipsDir(''))
  ok('resolveClipsDir("") 命中包内 assets/videos',
    host.resolveClipsDir('').replace(/\\/g, '/').endsWith('assets/videos'), host.resolveClipsDir(''))
}

console.log('\n[①] 体检与会话日志')
{
  const problems = []
  const ctx = { logger: { warn: (m) => problems.push(m), info: () => {}, error: () => {} } }
  host.writeConfig({ dir: join(home, 'nope') })
  const st = host.diagnose(ctx)
  ok('体检把问题收集起来', st.ok === false && st.problems.some((p) => p.includes('不存在')), st.problems)
  ok('体检同时写了一条宿主日志', problems.length > 0, problems)
}

/* ------------------------------------------------ ② 桩宿主跑 apply */

function makeCtx() {
  const routes = []
  const injections = []
  const ctx = {
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    effect: (fn) => { const d = fn(); return d },
    on: (event, cb) => { if (event === 'webserver/index-inject') injections.push(cb) },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }
  return { ctx, routes, injections }
}

function fakeRes() {
  const out = { code: null, headers: null, body: null, ended: false }
  return {
    out,
    writeHead(code, headers) { out.code = code; out.headers = headers },
    end(body) { out.ended = true; out.body = body === undefined ? null : String(body) },
    get headersSent() { return out.code !== null },
  }
}

function fakeReq({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const handlers = {}
  return {
    method,
    url,
    headers,
    on(event, cb) {
      handlers[event] = cb
      if (event === 'end') {
        queueMicrotask(() => {
          if (body !== null && typeof handlers.data === 'function') handlers.data(Buffer.from(body))
          if (typeof handlers.end === 'function') handlers.end()
        })
      }
      return this
    },
    destroy() {},
  }
}

console.log('\n[②] 宿主 apply：路由与注入行数')
{
  host.writeConfig({ enabled: true, dir: videos, clips: [], fadeMs: 1200, enterMode: 'tail', holdMs: 8000 })
  const { ctx, routes, injections } = makeCtx()
  host.apply(ctx)

  ok('注册了 4 条路由', routes.length === 4, routes.map((r) => `${r.kind}:${r.path}`))
  ok('只有 clip 用 prefix（避免吃掉自己的 client.js）', routes.filter((r) => r.kind === 'prefix').length === 1 && routes.find((r) => r.kind === 'prefix').path.endsWith('/clip'))
  ok('manifest/status/config 都是 exact', ['/clips.json', '/status.json', '/config.json'].every((p) => routes.some((r) => r.kind === 'exact' && r.path.endsWith(p))))
  ok('订阅了 index 注入', injections.length === 1)

  const table = []
  injections[0](table)
  ok('开 ⇒ 推 2 行（配置全局 + 面板脚本）', table.length === 2, table.map((r) => r.kind + ':' + (r.name ?? '')))
  ok('第一行是配置全局且带 manifest 地址', table[0].kind === 'global' && table[0].name === '__BOOT_SPLASH_CFG__' && String(table[0].value.manifest).includes('/plugins/boot-splash/clips.json'))
  ok('第二行是 head 脚本且内容非空', table[1].kind === 'script' && table[1].placement === 'head' && table[1].text.length > 100)

  host.writeConfig({ enabled: false })
  const table2 = []
  injections[0](table2)
  ok('关 ⇒ 推 0 行（真关闭）', table2.length === 0)

  host.writeConfig({ enabled: true })
}

console.log('\n[②] 路由行为：manifest / status / config 读 / 写守卫')
{
  host.writeConfig({ enabled: true, dir: videos, clips: [], fadeMs: 1200, enterMode: 'tail', holdMs: 8000 })
  const { ctx, routes } = makeCtx()
  host.apply(ctx)
  const route = (suffix) => routes.find((r) => r.path.endsWith(suffix)).handler

  {
    const res = fakeRes()
    route('/clips.json')(fakeReq({ url: '/plugins/boot-splash/clips.json' }), res)
    await new Promise((r) => setTimeout(r, 20))
    const body = JSON.parse(res.out.body)
    ok('manifest 返回素材与生效配置', res.out.code === 200 && body.clips.length === 2 && body.fadeMs === 1200)
    ok('素材 URL 带 rev 且指向 clip 路由', body.clips.every((c) => c.src.startsWith('/plugins/boot-splash/clip/')))
    ok('manifest 也是 no-store', res.out.headers['cache-control'] === 'no-store')
  }
  {
    const res = fakeRes()
    route('/status.json')(fakeReq({ url: '/plugins/boot-splash/status.json' }), res)
    await new Promise((r) => setTimeout(r, 20))
    const body = JSON.parse(res.out.body)
    ok('status 报出面板可读与已注入', body.panelReadable === true && body.injected === true && body.ok === true, body.problems)
  }
  {
    const res = fakeRes()
    route('/config.json')(fakeReq({ url: '/plugins/boot-splash/config.json' }), res)
    await new Promise((r) => setTimeout(r, 20))
    const body = JSON.parse(res.out.body)
    ok('config 读返回生效值 + 默认值 + 路径', body.effective.fadeMs === 1200 && body.defaults.fadeMs === 2000 && String(body.configPath).endsWith('boot-splash.json'))
  }
  {
    const res = fakeRes()
    route('/config.json')(fakeReq({ method: 'POST', url: '/plugins/boot-splash/config.json', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fadeMs: 999 }) }), res)
    await new Promise((r) => setTimeout(r, 30))
    ok('无自定义头的写被拒（403）', res.out.code === 403, res.out.body)
  }
  {
    const res = fakeRes()
    route('/config.json')(fakeReq({ method: 'POST', url: '/plugins/boot-splash/config.json', headers: { 'content-type': 'application/json', 'x-boot-splash-write': '1', origin: 'http://evil.example' }, body: JSON.stringify({ fadeMs: 999 }) }), res)
    await new Promise((r) => setTimeout(r, 30))
    ok('非本机 Origin 的写被拒（403）', res.out.code === 403, res.out.body)
  }
  {
    const res = fakeRes()
    route('/config.json')(fakeReq({ method: 'POST', url: '/plugins/boot-splash/config.json', headers: { 'content-type': 'application/json', 'x-boot-splash-write': '1', origin: 'http://127.0.0.1:19387' }, body: JSON.stringify({ fadeMs: 999 }) }), res)
    await new Promise((r) => setTimeout(r, 40))
    const body = JSON.parse(res.out.body)
    ok('本机 + 自定义头的写成功（200）', res.out.code === 200 && body.ok === true && body.effective.fadeMs === 999, res.out.body)
    ok('写后文件里确实是新值', host.readConfig().value.fadeMs === 999)
  }
  {
    const res = fakeRes()
    host.writeConfig({ dir: videos, clips: ['ok.mp4'] })
    route('/clip')(fakeReq({ url: '/plugins/boot-splash/clip/ok.mp4' }), res)
    await new Promise((r) => setTimeout(r, 30))
    ok('素材字节路由返回 200 + no-store + 可范围请求', res.out.code === 200 && res.out.headers['cache-control'] === 'no-store' && res.out.headers['accept-ranges'] === 'bytes')
  }
  {
    const res = fakeRes()
    route('/clip')(fakeReq({ url: '/plugins/boot-splash/clip/..%2F..%2Fboot-splash.json' }), res)
    await new Promise((r) => setTimeout(r, 30))
    ok('穿越尝试被拒（404）', res.out.code === 404, res.out.body)
  }
}

/* ------------------------------------------------ ③ 客户端半侧（桩壳） */

console.log('\n[③] 客户端半侧：报到 + 两条通路都尝试注册')
{
  const src = readFileSync(join(ROOT, 'client.js'), 'utf8')
  const registrations = []
  const readyCalls = []
  const logs = []

  const reactStub = {
    createElement: () => ({}),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
  }
  const slots = {
    register: (options) => { registrations.push(options); return () => {} },
    inject: (name, cb) => { const r = cb(); registrations.push({ injected: name }); return r },
  }
  const owner = { get: (n) => (n === 'slots' ? slots : n === 'locale' ? { register: () => () => {} } : undefined), effect: (fn) => fn() }
  const ctx = { inject: (deps, cb) => cb(owner) }

  const loader = { load: (def) => { loader.def = def } }
  const sandbox = {
    window: { __ModuleLoader__: loader },
    globalThis: { __BOOT_SPLASH__: { clientReady: () => readyCalls.push(1) } },
    console: { info: (m) => logs.push('info:' + m), warn: (m) => logs.push('warn:' + m) },
    require: (name) => (name === 'react' ? reactStub : undefined),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ effective: host.DEFAULTS, defaults: host.DEFAULTS, source: 'file', problems: [], configPath: 'x', enterMode: 'tail' }) }),
  }

  // 用一个受控的 CJS 环境执行 client.js：window/console/require/fetch/globalThis 全由我们给
  const wrapped = new Function('window', 'globalThis', 'console', 'require', 'fetch', src)
  wrapped(sandbox.window, sandbox.globalThis, sandbox.console, sandbox.require, sandbox.fetch)

  ok('client.js 调用了 __ModuleLoader__.load', loader.def !== undefined && loader.def.id === 'boot-splash')
  const mod = loader.def.factory(sandbox.require)
  ok('工厂返回 apply', typeof mod.apply === 'function')

  mod.apply(ctx)
  ok('①报到：调了 clientReady', readyCalls.length === 1)
  ok('注册到 settings.section', registrations.some((r) => r.name === 'settings.section' && r.id === 'boot-splash'), registrations)
  ok('尝试注册到 plugins.bundle.config（keyed）', registrations.some((r) => r.name === 'plugins.bundle.config' && r.key === 'boot-splash') || registrations.some((r) => r.injected === 'plugins.bundle.config'), registrations)
  ok('有一句"已注册到 settings.section"的信息日志', logs.some((l) => l.includes('已注册到 settings.section')), logs)
  // 防复发：我们的代码在每个失败点都会 warn ⇒ happy path 里出现任何 warn 就是有故障
  //（2026-10-02 真实踩过：编辑残留 `if (!keyedDone)` 引用已删变量 ⇒ ReferenceError 被外层 catch 吃掉）
  ok('happy path 不产生任何告警', !logs.some((l) => l.startsWith('warn:')), logs.filter((l) => l.startsWith('warn:')))
}

/* --------------------------- ③b 回归：槽"尚未声明"时不得抢跑（必须 inject 等槽） */

console.log('\n[③b] 回归：槽未声明时不得抢跑')
{
  const src = readFileSync(join(ROOT, 'client.js'), 'utf8')
  const readyCalls = []
  const registrations = []
  const wakes = []
  const logs = []
  let declared = false

  const reactStub = {
    createElement: () => ({}),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
  }
  // 假 slots：未声明时 register 就抛（与真机上的报错同形）；inject 挂起，等"声明"后由测试唤醒
  const slots = {
    register: (options) => {
      if (!declared) throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`)
      registrations.push(options)
      return () => {
        const i = registrations.indexOf(options)
        if (i >= 0) registrations.splice(i, 1)
      }
    },
    inject: (name, cb) => { wakes.push({ name, cb }); return () => {} },
  }
  const owner = {
    get: (n) => (n === 'slots' ? slots : n === 'locale' ? { register: () => () => {} } : undefined),
    effect: (fn) => fn(),
  }
  const ctx = { inject: (deps, cb) => cb(owner) }
  const loader = { load: (def) => { loader.def = def } }
  const sandbox = {
    window: { __ModuleLoader__: loader },
    globalThis: { __BOOT_SPLASH__: { clientReady: () => readyCalls.push(1) } },
    console: { info: (m) => logs.push('info:' + m), warn: (m) => logs.push('warn:' + m) },
    require: (name) => (name === 'react' ? reactStub : undefined),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ effective: host.DEFAULTS, defaults: host.DEFAULTS, source: 'file', problems: [], configPath: 'x', enterMode: 'tail' }) }),
  }
  const wrapped = new Function('window', 'globalThis', 'console', 'require', 'fetch', src)
  wrapped(sandbox.window, sandbox.globalThis, sandbox.console, sandbox.require, sandbox.fetch)
  const mod = loader.def.factory(sandbox.require)

  let threw = null
  try { mod.apply(ctx) } catch (error) { threw = error }
  ok('槽未声明时 apply 不抛（改为挂起等待）', threw === null, threw && String(threw.message))
  ok('槽未声明时没有直接 register（未抢跑）', registrations.length === 0, registrations)
  ok('两条槽各挂起一次 inject', wakes.filter((w) => w.name === 'settings.section').length === 1 && wakes.filter((w) => w.name === 'plugins.bundle.config').length === 1, wakes.map((w) => w.name))
  ok('报到不受注册路径影响（仍照常 clientReady）', readyCalls.length === 1)
  ok('没有出现 "is not declared" 的告警', !logs.some((l) => l.includes('is not declared')), logs.filter((l) => l.startsWith('warn')))

  declared = true
  for (const w of wakes) w.cb()
  ok('槽声明后：settings.section 注册成功', registrations.some((r) => r.name === 'settings.section' && r.id === 'boot-splash'), registrations)
  ok('槽声明后：plugins.bundle.config 注册成功（keyed）', registrations.some((r) => r.name === 'plugins.bundle.config' && r.key === 'boot-splash'), registrations)
  ok('全程不产生告警（含"接线失败/注册失败/未定义"之类）', !logs.some((l) => l.startsWith('warn:')), logs.filter((l) => l.startsWith('warn:')))
}

/* -------------------------------------------------------------- 收尾 */

rmSync(home, { recursive: true, force: true })
console.log(`\nboot-splash 验证：通过 ${pass} / 失败 ${fail}`)
if (fail > 0) console.log('失败项：' + fails.join(' | '))
process.exit(fail === 0 ? 0 : 1)
