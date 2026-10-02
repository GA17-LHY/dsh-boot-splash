/**
 * boot-splash · 宿主半侧（在 DSH 进程里跑的那一半）
 *
 * 与那款第三方插件的三点关键差异：
 *  ① **不依赖 @deepseek-ai/schemastery**：配置是纯 JSON 文件，没有静态 import
 *      ⇒ 不会出现"依赖解析不到 ⇒ 整个模块求值失败 ⇒ 路由和开机画面一起没"。
 *  ② **零静默失败**：任何一处走不下去，都记进 `problems` 并出现在
 *     `/status.json` 与宿主日志里；不再有"什么都不说"的分支。
 *  ③ **配置以文件为准**（`$DSH_HOME/boot-splash.json`），设置界面只是可选的编辑入口
 *     —— 界面挂不上，功能依然可用。
 *
 * 两条硬约束（来自对 load 时机的实测，别动）：
 *  · `webserver/index-inject` 是**唯一足够早**的时机：推进去的行会渲染进 `<head>`，
 *    早于外壳模块；更晚的任何手段都盖不住内核启动页。
 *  · 路由必须用 **exact**（manifest/status/config），只有 `/clip` 用 prefix。
 *    在 ROUTE 上挂 prefix 会把 `/plugins/boot-splash/client.js` 一起吃掉，
 *    而那条 URL 是 client-modules 用来物化本包客户端 bundle 的
 *    ⇒ 客户端半侧永远加载不了（这是那款插件的注释里写明的坑）。
 *
 * @module boot-splash/host
 */

import {
  existsSync, mkdirSync, openSync, closeSync, readSync, readdirSync,
  readFileSync, renameSync, statSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, resolve as resolvePath, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const name = 'boot-splash'
/** 只需要 webServer（注册路由 + 往 index 注入）。 */
export const inject = ['webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const ROUTE = '/plugins/boot-splash'
const DSH_HOME = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
  ? process.env.DSH_HOME.trim()
  : join(homedir(), '.dsh')
const CONFIG_PATH = join(DSH_HOME, 'boot-splash.json')
const PANEL_PATH = join(HERE, 'panel.js')
/** 包内自带素材目录（发布出去时随包分发；见 assets/videos/LICENSE-dsh-boot-animation.txt）。 */
const BUNDLED_DIR = join(HERE, 'assets', 'videos')

const ENTER_MODES = ['tail', 'end', 'click']
const SOUND_MODES = ['auto', 'gesture', 'mute']
const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v', '.mov'])

export const DEFAULTS = Object.freeze({
  /** 总开关：关掉 = 一行都不注入、一次素材请求都不发。 */
  enabled: true,
  /** 淡入淡出的时长（毫秒）。 */
  fadeMs: 2000,
  /** 进入方式：tail=片尾交叉溶解 / end=放完再淡 / click=点击才进。 */
  enterMode: 'tail',
  /** 兜底上限：内核迟迟不就绪时最多等多久（毫秒），到点提示可点击。 */
  holdMs: 15000,
  /** 素材目录（绝对路径或 ~/ 开头）。**留空 = 用包内自带素材**（assets/videos）；两边都没有则只有渐变底。 */
  dir: '',
  /** 要参与轮播的文件名（相对 dir）；空数组 = 目录里所有视频都参与。 */
  clips: [],
  /** 声音模式：auto=先试带声自动播放（被拒退回静音）/ gesture=静音起播·第一下点击开声（默认）/ mute=始终静音。 */
  sound: 'gesture',
  /** 音量 0–100。 */
  volume: 100,
})

/* ------------------------------------------------------------------ 配置读写 */

const isPlainString = (v) => typeof v === 'string' && v.length <= 4096 && !v.includes('\0')

/**
 * 校验一份配置。**不抛异常**：把问题收集到 `problems` 里，能修的字段用默认值兜住。
 * @param {unknown} raw - 待校验对象。
 * @returns {{value: object, problems: string[]}} 生效值 + 问题清单。
 */
export function validateConfig(raw) {
  const problems = []
  const out = { ...DEFAULTS }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { value: out, problems: ['配置不是 JSON 对象，已整体回落到默认值'] }
  }
  if ('enabled' in raw) {
    if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled
    else problems.push('enabled 必须是布尔值，已用默认值')
  }
  if ('fadeMs' in raw) {
    const n = Number(raw.fadeMs)
    if (Number.isFinite(n) && n >= 0 && n <= 10000) out.fadeMs = Math.round(n)
    else problems.push('fadeMs 必须是 0–10000 的数字，已用默认值')
  }
  if ('enterMode' in raw) {
    if (ENTER_MODES.includes(raw.enterMode)) out.enterMode = raw.enterMode
    else problems.push(`enterMode 必须是 ${ENTER_MODES.join(' / ')} 之一，已用默认值`)
  }
  if ('holdMs' in raw) {
    const n = Number(raw.holdMs)
    if (Number.isFinite(n) && n >= 1000 && n <= 120000) out.holdMs = Math.round(n)
    else problems.push('holdMs 必须是 1000–120000 的数字，已用默认值')
  }
  if ('dir' in raw) {
    if (isPlainString(raw.dir)) out.dir = raw.dir
    else problems.push('dir 必须是字符串，已用默认值')
  }
  if ('clips' in raw) {
    if (Array.isArray(raw.clips) && raw.clips.every((x) => isPlainString(x))) out.clips = raw.clips.slice(0, 200)
    else problems.push('clips 必须是字符串数组，已用默认值')
  }
  if ('sound' in raw) {
    if (SOUND_MODES.includes(raw.sound)) out.sound = raw.sound
    else problems.push(`sound 必须是 ${SOUND_MODES.join(' / ')} 之一，已用默认值`)
  }
  if ('volume' in raw) {
    const n = Number(raw.volume)
    if (Number.isFinite(n) && n >= 0 && n <= 100) out.volume = Math.round(n)
    else problems.push('volume 必须是 0–100 的数字，已用默认值')
  }
  const known = new Set(Object.keys(DEFAULTS))
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) problems.push(`未知字段 ${key}（已忽略）`)
  }
  return { value: out, problems }
}

/** 把 `~/x` 展开成绝对路径。 */
function expandHome(p) {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

/**
 * 读一次配置。**永不抛**：文件不存在/读不了/JSON 坏，都回落到默认值并把原因说清。
 * @returns {{value: object, problems: string[], exists: boolean, source: string}}
 */
export function readConfig() {
  const problems = []
  if (!existsSync(CONFIG_PATH)) {
    return { value: { ...DEFAULTS }, problems, exists: false, source: 'defaults（配置文件还不存在）' }
  }
  let text
  try {
    text = readFileSync(CONFIG_PATH, 'utf8')
  } catch (error) {
    return { value: { ...DEFAULTS }, problems: [`配置文件读不了：${String(error?.message ?? error)}`], exists: true, source: 'defaults（读失败）' }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { value: { ...DEFAULTS }, problems: [`配置文件不是合法 JSON：${String(error?.message ?? error)}`], exists: true, source: 'defaults（JSON 坏）' }
  }
  const { value, problems: fieldProblems } = validateConfig(parsed)
  return { value, problems: fieldProblems, exists: true, source: 'file' }
}

/**
 * 合并写入配置（原子：先写临时文件再改名）。写的是**合并后**的完整对象，
 * 这样界面上只改一项也不会把别的项抹掉。
 * @param {object} patch - 要改的字段。
 * @returns {{ok: boolean, problems: string[], value?: object, error?: string}}
 */
export function writeConfig(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, problems: [], error: '请求体必须是 JSON 对象' }
  }
  const current = readConfig().value
  const { value, problems } = validateConfig({ ...current, ...patch })
  const fatal = problems.filter((p) => !p.startsWith('未知字段'))
  if (fatal.length > 0) return { ok: false, problems, error: '有字段没通过校验，未写入' }
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true })
    const tmp = `${CONFIG_PATH}.tmp-${process.pid}`
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(tmp, CONFIG_PATH)
    return { ok: true, problems, value }
  } catch (error) {
    return { ok: false, problems, error: `写入失败：${String(error?.message ?? error)}` }
  }
}

/* ---------------------------------------------------------------- 素材与诊断 */

/** 读文件头，判断 mp4 的 moov 是否在 mdat 之前（未优化会让抽帧式播放出不来画面）。 */
export function probeFaststart(file) {
  if (extname(file).toLowerCase() !== '.mp4') return null
  let fd
  try {
    fd = openSync(file, 'r')
    const head = Buffer.alloc(Math.min(262144, statSync(file).size))
    readSync(fd, head, 0, head.length, 0)
    let off = 0
    for (let i = 0; i < 12 && off + 8 <= head.length; i++) {
      const size = head.readUInt32BE(off)
      const type = head.subarray(off + 4, off + 8).toString('latin1')
      if (type === 'moov') return true
      if (type === 'mdat') return false
      if (size <= 0) break
      off += size
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * 列出素材目录里的视频。**任何问题都不抛**，返回 `{clips, problems}`。
 * @param {string} dirRaw - 配置里的目录。
 * @param {string[]} wanted - 要参与的文件名（空 = 全部）。
 */
/**
 * 解析生效的素材目录：**配置非空用配置**；留空则用**包内自带素材**（`assets/videos`，有视频才用）；
 * 两者都没有 ⇒ `''`（只有渐变底）。这样"装完即有画面"，而想只要渐变底把 `dir` 指向一个空目录即可。
 * @param {unknown} configured - 配置里的 `dir`。
 * @returns {string} 绝对路径，或空串。
 */
export function resolveClipsDir(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') return expandHome(configured.trim())
  try {
    if (existsSync(BUNDLED_DIR) && readdirSync(BUNDLED_DIR).some((n) => VIDEO_EXT.has(extname(n).toLowerCase()))) {
      return BUNDLED_DIR
    }
  } catch { /* 读不到就按"没有自带素材"处理 */ }
  return ''
}

export function listClips(dirRaw, wanted) {
  const problems = []
  const dir = resolveClipsDir(dirRaw)
  if (dir === '') return { clips: [], problems: ['没有可用素材（既没配 dir、包内也没有自带素材）⇒ 只有渐变底'], dir }
  if (!existsSync(dir)) return { clips: [], problems: [`素材目录不存在：${dir}`], dir }
  let names
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && VIDEO_EXT.has(extname(e.name).toLowerCase()))
      .map((e) => e.name)
  } catch (error) {
    return { clips: [], problems: [`素材目录读不了：${String(error?.message ?? error)}`], dir }
  }
  const pool = wanted.length > 0 ? names.filter((n) => wanted.includes(n)) : names
  const missing = wanted.filter((w) => !names.includes(w))
  if (missing.length > 0) problems.push(`配置里列了但目录里没有：${missing.join('、')}`)
  const clips = pool.sort().map((n) => {
    const file = join(dir, n)
    let bytes = null
    let mtime = null
    try {
      const st = statSync(file)
      bytes = st.size
      mtime = Math.round(st.mtimeMs)
    } catch { /* 保持 null，下面会体现为未知 */ }
    return { name: n, file, bytes, mtime, faststart: probeFaststart(file) }
  })
  if (clips.length === 0) problems.push('素材目录里没有可用的视频（支持 .mp4/.webm/.m4v/.mov）⇒ 只有一个渐变底')
  return { clips, problems, dir }
}

/** 读开机面板脚本（每次 index 渲染现读 ⇒ 改它只要刷新页面）。 */
export function panelSource() {
  try {
    return { text: readFileSync(PANEL_PATH, 'utf8'), problems: [] }
  } catch (error) {
    return { text: '', problems: [`panel.js 读不了：${String(error?.message ?? error)}`] }
  }
}

/**
 * 一次把所有会出问题的地方都查一遍 —— 这是本插件"零静默失败"的落点：
 * 界面上、`/status.json` 里、宿主日志里都能看到同一份结论。
 * @param {{logger?: object}} ctx - 宿主上下文（只用来打日志，可缺省）。
 */
export function diagnose(ctx) {
  const cfg = readConfig()
  const listed = listClips(cfg.value.dir, cfg.value.clips)
  const panel = panelSource()
  const problems = [...cfg.problems, ...listed.problems, ...panel.problems]
  if (!cfg.value.enabled) problems.push('总开关是关的 ⇒ 本插件当前不注入任何东西')
  const status = {
    ok: problems.length === 0,
    configPath: CONFIG_PATH,
    configExists: cfg.exists,
    configSource: cfg.source,
    effective: cfg.value,
    clipsDir: listed.dir,
    clips: listed.clips,
    panelPath: PANEL_PATH,
    panelBytes: panel.text.length,
    problems,
  }
  if (problems.length > 0) {
    // 宿主日志里留一条：出错时不必先猜"它到底加载没加载"。
    ctx?.logger?.warn?.(`boot-splash: ${problems.length} 项待处理 —— ${problems[0]}`)
  }
  return status
}

/* -------------------------------------------------------------------- HTTP */

function sendJson(res, code, body) {
  const text = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function readBody(req, limit = 65536) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        resolve({ ok: false, error: `请求体超过 ${limit} 字节` })
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') }))
    req.on('error', (error) => resolve({ ok: false, error: String(error?.message ?? error) }))
  })
}

/** 只允许写本地来源：带 Origin 时必须是回环；并强制自定义头（跨源简单请求带不上自定义头）。 */
function isLocalWrite(req) {
  const origin = req.headers?.origin
  if (typeof origin === 'string' && origin !== '' && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) {
    return `Origin 不是本机：${origin}`
  }
  if (req.headers?.['x-boot-splash-write'] !== '1') return '缺少 x-boot-splash-write: 1 头'
  return null
}

/**
 * 挂载路由与开机注入。
 * @param {object} ctx - 宿主插件上下文。
 */
export function apply(ctx) {
  const server = ctx.webServer

  // 启动即体检一次：让"没生效"从第一秒起就有话说。
  const boot = diagnose(ctx)
  if (boot.problems.length > 0) {
    ctx.logger?.warn?.(`boot-splash: 启动体检有 ${boot.problems.length} 项：${boot.problems.join(' | ')}`)
  } else {
    ctx.logger?.info?.(`boot-splash: 就绪（素材 ${boot.clips.length} 段，配置 ${boot.configSource}）`)
  }

  const guard = (label, fn) => (req, res) => {
    void (async () => {
      try {
        await fn(req, res)
      } catch (error) {
        ctx.logger?.error?.(`boot-splash: ${label} 处理失败`, error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal', label, detail: String(error?.message ?? error) })
        else res.end()
      }
    })()
  }

  // ① 配置：读（界面用它渲染）+ 写（界面用它保存）。写走文件，不碰 DSH 设置服务。
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${ROUTE}/config.json`,
    handler: guard('config', async (req, res) => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const cfg = readConfig()
        sendJson(res, 200, {
          effective: cfg.value,
          defaults: DEFAULTS,
          configPath: CONFIG_PATH,
          configExists: cfg.exists,
          source: cfg.source,
          problems: cfg.problems,
          enterModes: ENTER_MODES,
        })
        return
      }
      if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return }
      const refusal = isLocalWrite(req)
      if (refusal) { sendJson(res, 403, { error: 'refused', reason: refusal }); return }
      const body = await readBody(req)
      if (!body.ok) { sendJson(res, 413, { error: body.error }); return }
      let patch
      try { patch = JSON.parse(body.text) } catch (error) {
        sendJson(res, 400, { error: `请求体不是合法 JSON：${String(error?.message ?? error)}` })
        return
      }
      const written = writeConfig(patch)
      if (!written.ok) { sendJson(res, 422, written); return }
      const after = readConfig()
      ctx.logger?.info?.(`boot-splash: 配置已更新（${Object.keys(patch).join('、')}）`)
      sendJson(res, 200, { ok: true, effective: after.value, problems: after.problems, configPath: CONFIG_PATH })
    }),
  }), 'boot-splash: config route')

  // ② 体检：把"到底哪里不对"一次说全。
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${ROUTE}/status.json`,
    handler: guard('status', async (req, res) => {
      const status = diagnose(ctx)
      const panel = panelSource()
      sendJson(res, 200, {
        ...status,
        panelReadable: panel.text.length > 0,
        injected: status.effective.enabled,
        routePrefix: ROUTE,
      })
    }),
  }), 'boot-splash: status route')

  // ③ 素材清单：客户端与开机面板都读它。
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${ROUTE}/clips.json`,
    handler: guard('clips', async (req, res) => {
      const cfg = readConfig()
      const listed = listClips(cfg.value.dir, cfg.value.clips)
      const rev = `${listed.clips.length}-${listed.clips.reduce((a, c) => a + (c.bytes ?? 0) + (c.mtime ?? 0), 0)}`
      sendJson(res, 200, {
        rev,
        enabled: cfg.value.enabled,
        fadeMs: cfg.value.fadeMs,
        enterMode: cfg.value.enterMode,
        holdMs: cfg.value.holdMs,
        clips: listed.clips.map((c) => ({
          name: c.name,
          // 带 rev 的 URL：文件一变，URL 就变 —— 避免任何陈旧缓存（配合 no-store）。
          src: `${ROUTE}/clip/${encodeURIComponent(c.name)}?v=${c.mtime ?? 0}-${c.bytes ?? 0}`,
          bytes: c.bytes,
          faststart: c.faststart,
        })),
        problems: [...cfg.problems, ...listed.problems],
      })
    }),
  }), 'boot-splash: clips route')

  // ④ 素材字节：唯一用 prefix 的路由（见文件头：不能让 prefix 盖住 ROUTE 本身）。
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${ROUTE}/clip`,
    handler: guard('clip', async (req, res) => {
      const cfg = readConfig()
      const listed = listClips(cfg.value.dir, cfg.value.clips)
      const raw = String(req.url ?? '')
      const name = basename(decodeURIComponent(raw.split('?')[0].replace(`${ROUTE}/clip/`, '')))
      const hit = listed.clips.find((c) => c.name === name)
      // 两道闸：basename 去掉目录成分 + 必须命中清单里的项 ⇒ 不存在穿越。
      if (hit === undefined || listed.dir === '') { sendJson(res, 404, { error: 'not found', name }); return }
      const abs = resolvePath(listed.dir, hit.name)
      if (!abs.startsWith(resolvePath(listed.dir) + sep) || !existsSync(abs)) {
        sendJson(res, 404, { error: 'not found', name })
        return
      }
      const size = statSync(abs).size
      const range = req.headers?.range
      const base = { 'content-type': 'video/mp4', 'cache-control': 'no-store', 'accept-ranges': 'bytes' }
      if (typeof range === 'string' && /^bytes=\d*-\d*$/.test(range)) {
        const [, s, e] = range.match(/^bytes=(\d*)-(\d*)$/)
        let start = s === '' ? size - Number(e) : Number(s)
        let end = s === '' || e === '' ? size - 1 : Number(e)
        start = Math.max(0, Math.min(start, size - 1))
        end = Math.max(start, Math.min(end, size - 1))
        const len = end - start + 1
        res.writeHead(206, { ...base, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': len })
        const fd = openSync(abs, 'r')
        try {
          const buf = Buffer.alloc(len)
          readSync(fd, buf, 0, len, start)
          res.end(buf)
        } finally { closeSync(fd) }
        return
      }
      res.writeHead(200, { ...base, 'content-length': size })
      const fd = openSync(abs, 'r')
      try {
        const buf = Buffer.alloc(size)
        readSync(fd, buf, 0, size, 0)
        res.end(buf)
      } finally { closeSync(fd) }
    }),
  }), 'boot-splash: clip route')

  // ⑤ 开机注入：配置行 + 面板脚本。关掉总开关 ⇒ 一行都不推（真关，不是"脚本自己判断"）。
  ctx.on('webserver/index-inject', (table) => {
    const cfg = readConfig()
    if (!cfg.value.enabled) return
    const listed = listClips(cfg.value.dir, cfg.value.clips)
    const panel = panelSource()
    if (panel.text === '') {
      ctx.logger?.error?.('boot-splash: panel.js 读不到 ⇒ 本次不注入开机画面（其余功能不受影响）')
      return
    }
    table.push({
      kind: 'global',
      name: '__BOOT_SPLASH_CFG__',
      value: {
        fadeMs: cfg.value.fadeMs,
        enterMode: cfg.value.enterMode,
        holdMs: cfg.value.holdMs,
        sound: cfg.value.sound,
        volume: cfg.value.volume,
        manifest: `${ROUTE}/clips.json`,
        route: ROUTE,
        problems: [...cfg.problems, ...listed.problems],
      },
    })
    table.push({ kind: 'script', placement: 'head', text: panel.text })
  })
}
