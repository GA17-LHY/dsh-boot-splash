/**
 * boot-splash · 客户端半侧（浏览器里跑的那一半）
 *
 * 两条通路都挂，哪个能出界面就用哪个（这是与那款第三方插件的核心区别：
 * 它只挂 `plugins.item` —— 那是**官方插件**用的槽，第三方 bundle 的配置页在
 * asar 的官方文档里写明应挂 `plugins.bundle.config`（以包名为键））：
 *   · `settings.section`      —— 设置里的整页（皮肤插件用的就是它，已验证能渲染）
 *   · `plugins.bundle.config` —— 插件页里按包名分组的配置位
 *
 * 另外两件事：
 *  ① 报到：外壳就绪时调 `globalThis.__BOOT_SPLASH__.clientReady()`，开机面板据此放行；
 *  ② 零静默失败：每一步都 `console.info/warn` 带结论，界面里也有"体检"块。
 *
 * 读写配置走宿主路由（`/plugins/boot-splash/config.json`），**不碰 DSH 设置服务**
 * ⇒ 不依赖 schemastery / volatile / whileServed 那一整条链。
 */
window.__ModuleLoader__.load({
  id: 'boot-splash',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var PKG = 'boot-splash'
    var ROUTE = '/plugins/boot-splash'
    var NS = 'settings.bootSplash'

    /** 注：不导出 inject（由宿主 app 注入的 slots 服务在 apply 时按需取）。 */

    var COPY = {
      zh: {
        nav: '启动画面',
        title: '启动画面',
        intro: '开机时叠一段全窗口画面，片尾交叉溶解进界面。配置存在文件里，改完刷新即生效。',
        enabled: '开启启动画面',
        fadeMs: '淡入淡出（毫秒）',
        enterMode: '进入方式',
        modeTail: '片尾交叉溶解',
        modeEnd: '放完再淡',
        modeClick: '点击才进',
        sound: '开机声音',
        soundAuto: '先试带声自动播放（浏览器可能拒绝，会自动退回静音）',
        soundGesture: '静音起播，第一下点击开声（推荐）',
        soundMute: '始终静音（不提示开声）',
        volume: '音量 0–100',
        holdMs: '最长等待（毫秒）',
        mode: '启动画面形态',
        modeVideo: '视频（全窗口播放素材）',
        modeStatus: '代码窗（启动状态窗，开机时显示程序在做什么）',
        modeBoth: '视频 + 状态窗（视频作背景）',
        lineGapMs: '逐行回放间隔（毫秒，0 = 不节流）',
        wordmark: '代码词标（用 | 分行，留空 = 不显示）',
        bg: '代码窗背景图（图片绝对路径或 ~/，留空 = 不用）',
        bgColor: '代码窗纯色背景（留空 = 不用；建议偏深，文字是浅色）',
        bgDim: '背景图压暗强度 0–100（只作用于图片）',
        wordmarkSize: '词标字号（0 = 按列宽自动适配）',
        wordmarkShine: '词标流光光效',
        wordmarkShineHint: '渐变光带扫过笔画；实现上每帧重绘这块文字，略耗性能',
        rmNote: '注意：系统开着「减少动态效果」（Windows 的"最佳性能"会开）——展开动画会被跳过；但**你显式打开的流光照常播放**。',
        wordmarkShineColor: '流光颜色',
        dir: '素材目录（留空＝只有渐变底）',
        clips: '参与轮播的文件名（每行一个；留空＝目录内全部）',
        save: '保存',
        reload: '重新读取',
        saved: '已保存',
        diagnose: '体检',
        problems: '发现的问题',
        none: '没有发现问题',
        configPath: '配置文件',
        clientLoadedAt: '本设置界面（客户端半侧）加载于',
        clipsFound: '目录里找到的素材',
        status: '运行状态',
        diag: '打开体检',
      },
      en: {
        nav: 'Boot splash',
        title: 'Boot splash',
        intro: 'Overlays a full-window clip during boot, then dissolves into the app. Config lives in a file; reload to apply.',
        enabled: 'Enable boot splash',
        fadeMs: 'Fade (ms)',
        enterMode: 'Entry mode',
        modeTail: 'Cross-dissolve at tail',
        modeEnd: 'Fade after the clip',
        modeClick: 'Click to enter',
        sound: 'Boot sound',
        soundAuto: 'Try autoplay with sound (may be refused; falls back to muted)',
        soundGesture: 'Start muted; first click turns sound on (recommended)',
        soundMute: 'Always muted (no sound hint)',
        volume: 'Volume 0–100',
        holdMs: 'Max wait (ms)',
        mode: 'Boot screen style',
        modeVideo: 'Video (full-window clip)',
        modeStatus: 'Code window (boot status, no video)',
        modeBoth: 'Video + status window',
        lineGapMs: 'Line pacing (ms, 0 = off)',
        wordmark: 'Code wordmark (| splits lines, empty = off)',
        bg: 'Code-window background image (absolute path or ~/, empty = none)',
        bgColor: 'Code-window solid colour (empty = none; pick a dark one, the text is light)',
        bgDim: 'Background-image dim 0–100 (images only)',
        wordmarkSize: 'Wordmark size (0 = auto-fit to width)',
        wordmarkShine: 'Wordmark shimmer',
        wordmarkShineHint: 'A gradient band sweeps the glyphs; it repaints this text every frame.',
        rmNote: 'Note: reduced motion is on (Windows "best performance" turns it on). The entrance animation is skipped, but the shimmer you explicitly enabled still plays.',
        wordmarkShineColor: 'Shimmer colour',
        dir: 'Clip directory (empty = gradient only)',
        clips: 'File names in rotation (one per line; empty = all in dir)',
        save: 'Save',
        reload: 'Reload',
        saved: 'Saved',
        diagnose: 'Diagnose',
        problems: 'Problems',
        none: 'No problems found',
        configPath: 'Config file',
        clientLoadedAt: 'This settings UI (client half) loaded at',
        clipsFound: 'Clips found',
        status: 'Runtime state',
        diag: 'Run diagnosis',
      },
    }

    /**
         * 客户端半侧的**加载时刻**（宿主启动时把本文件快照进内存 ⇒ 改 client.js **必须重启宿主**，刷新不够）。
         * 把它显示在设置页底部：一旦"改了没生效"，先看这个时间——它比你的上次重启还早，就说明页面跑的是旧代码。
         */
    var CLIENT_LOADED_AT = Date.now()

    function log(message) { try { console.info('boot-splash: ' + message) } catch (e) { /* 忽略 */ } }
    function warn(message, error) { try { console.warn('boot-splash: ' + message, error === undefined ? '' : error) } catch (e) { /* 忽略 */ } }

    async function getJson(path) {
      var r = await fetch(ROUTE + path, { cache: 'no-store' })
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path)
      return r.json()
    }

    async function readConfig() { return getJson('/config.json') }
    async function readStatus() { return getJson('/status.json') }

    /** 写配置：带自定义头（跨源简单请求带不上它）⇒ 只有本机同源页面能写。 */
    async function writeConfig(patch) {
      var r = await fetch(ROUTE + '/config.json', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-boot-splash-write': '1' },
        body: JSON.stringify(patch),
      })
      var body = await r.json().catch(function () { return {} })
      if (!r.ok || body.ok !== true) {
        // reason 必须一起显示：原来只显示 'refused'，看不出到底为什么被拒（本轮排查就吃过这个亏）
        throw new Error('保存被拒：' + (body.reason || body.error || ('HTTP ' + r.status)) + (body.problems ? '（' + body.problems.join('；') + '）' : ''))
      }
      return body
    }

    /* --------------------------------------------------------------- 界面 */

    function value(v, fallback) { return v === undefined || v === null ? fallback : v }

    function Controls(props) {
      var React = props.React
      var h = React.createElement
      var t = props.t
      var state = props.state
      var setStateRaw = props.setState
      var save = props.save
      var reload = props.reload
      var diagnose = props.diagnose
      // 改一项就**自动保存**（防抖 500ms），不必再点「保存」。
      // 用户 2026-10-04 报：「设置里修改选项，要点一次保存才能生效，改掉这个问题」。
      // ⚠ 保存 ≠ 立刻生效：这些配置作用于**开机覆盖层**，要刷新页面（或重启应用）才会重新渲染 ——
      //    所以保存后的提示仍写「刷新页面生效」。保存按钮保留，作为手动重试入口。
      var autoTimer = 0
      var setState = function (patch) {
        setStateRaw(patch)
        try { if (autoTimer) clearTimeout(autoTimer) } catch (e) { /* 忽略 */ }
        autoTimer = setTimeout(function () { try { save() } catch (e) { /* 忽略 */ } }, 500)
      }
      var busy = props.busy
      var status = props.status
      var message = props.message

      /**
       * 一行设置：**左标签、右控件**、行间细分隔线、标签下可挂一行灰色小字 ——
       * 照「皮肤管理」页的设计语言。配色刻意**跟主题走**（currentColor + 半透明）：
       * 那页的底色是**皮肤给的**，皮肤一切换/关掉，写死颜色就会很难看。
       */
      var hairline = '1px solid rgba(127,127,127,.22)'
      var field = function (key, render, hint) {
        return h('div', {
          key: key,
          style: { display: 'flex', alignItems: 'center', gap: 16, padding: '12px 2px', borderBottom: hairline },
        },
        h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
          h('div', { style: { fontSize: 14 } }, t(key)),
          hint ? h('div', { style: { fontSize: 12, opacity: 0.6, marginTop: 2, lineHeight: 1.5 } }, t(hint)) : null),
        h('div', { style: { flex: '0 0 auto' } }, render()))
      }

      /**
       * 胶囊开关。形状**照抄宿主自己的 Switch.module.css**（`dsh-client-ui-primitives`）：
       * 36×20 轨道 / 16px 滑块 / `translateX(16px)` 位移 / 颜色全走主题别名变量。
       *
       * ⚠ **关键是 `corner-shape: round`**：宿主/皮肤对控件施加了全局 **superellipse（方圆角）**，
       * 不显式 opt out 的话，连 `border-radius:999px` 都会被画成**圆角方形** ——
       * 我为此误判过两轮（先怪 `<button>` 的 `!important`、再改成 `<span>`，都不对）。
       * 宿主那句注释写得很清楚：*"The capsule track and circular thumb opt out of the global superellipse"*。
       *
       * 也曾试过直接 `require` 宿主那个 Switch 组件来用 —— **会把设置页整页搞白**（渲染抛错，原因未查明），
       * 所以改为**抄它的样式**：不依赖额外模块，也不会白屏。
       */
      var switchEl = function (checked, onChange) {
        var on = checked === true
        return h('span', {
          role: 'switch',
          tabIndex: 0,
          'aria-checked': on,
          'aria-disabled': busy === true,
          onClick: function () { if (busy !== true) onChange(!on) },
          onKeyDown: function (e) {
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (busy !== true) onChange(!on) }
          },
          style: {
            boxSizing: 'border-box', position: 'relative', flex: '0 0 auto',
            display: 'inline-block',
            width: 36, height: 20, padding: 2, border: 0,
            borderRadius: 999, cornerShape: 'round',
            background: on ? 'var(--dsw-alias-brand-primary,#4a6fd0)' : 'var(--dsw-alias-border-l3,#8a8f98)',
            cursor: busy === true ? 'default' : 'pointer',
            opacity: busy === true ? 0.5 : 1,
          },
        }, h('span', {
          style: {
            display: 'block', width: 16, height: 16,
            borderRadius: '50%', cornerShape: 'round',
            background: on
              ? 'var(--dsw-alias-label-primary-foreground,#ffffff)'
              : 'var(--dsw-alias-switch-thumb,#ffffff)',
            transform: on ? 'translateX(16px)' : 'none',
            transition: 'transform 120ms ease',
          },
        }))
      }

      var rows = []
      rows.push(field('enabled', function () {
        return switchEl(state.enabled === true, function (v) { setState({ enabled: v }) })
      }))
      rows.push(field('mode', function () {
        var modes = [['video', 'modeVideo'], ['status', 'modeStatus'], ['both', 'modeBoth']]
        return h('select', {
          value: value(state.mode, 'video'),
          onChange: function (e) { setState({ mode: e.target.value }) },
        }, modes.map(function (m) { return h('option', { key: m[0], value: m[0] }, t(m[1])) }))
      }))
      rows.push(field('lineGapMs', function () {
        return h('input', {
          type: 'number',
          value: value(state.lineGapMs, 120),
          onChange: function (e) { setState({ lineGapMs: Number(e.target.value) }) },
        })
      }))
      rows.push(field('fadeMs', function () {
        return h('input', {
          type: 'number', min: 0, max: 10000, step: 100,
          value: value(state.fadeMs, 2000),
          onChange: function (e) { setState({ fadeMs: Number(e.target.value) }) },
          style: { width: 120 },
        })
      }))
      rows.push(field('enterMode', function () {
        var modes = [['tail', 'modeTail'], ['end', 'modeEnd'], ['click', 'modeClick']]
        return h('select', {
          value: value(state.enterMode, 'tail'),
          onChange: function (e) { setState({ enterMode: e.target.value }) },
        }, modes.map(function (m) { return h('option', { key: m[0], value: m[0] }, t(m[1])) }))
      }))
      rows.push(field('sound', function () {
        var modes = [['gesture', 'soundGesture'], ['auto', 'soundAuto'], ['mute', 'soundMute']]
        return h('select', {
          value: value(state.sound, 'gesture'),
          onChange: function (e) { setState({ sound: e.target.value }) },
        }, modes.map(function (m) { return h('option', { key: m[0], value: m[0] }, t(m[1])) }))
      }))
      rows.push(field('volume', function () {
        return h('input', {
          type: 'number', min: 0, max: 100, step: 5,
          value: value(state.volume, 100),
          onChange: function (e) { setState({ volume: Number(e.target.value) }) },
          style: { width: 120 },
        })
      }))
      rows.push(field('holdMs', function () {
        return h('input', {
          type: 'number', min: 1000, max: 120000, step: 1000,
          value: value(state.holdMs, 15000),
          onChange: function (e) { setState({ holdMs: Number(e.target.value) }) },
          style: { width: 120 },
        })
      }))
      rows.push(field('dir', function () {
        return h('input', {
          type: 'text', style: { width: '100%' }, placeholder: '素材目录，例如 /path/to/videos 或 ~/videos',
          value: value(state.dir, ''),
          onChange: function (e) { setState({ dir: e.target.value }) },
        })
      }))
      rows.push(field('wordmark', function () {
        return h('input', {
          type: 'text',
          value: value(state.wordmark, 'Exploring the unexplored'),
          onChange: function (e) { setState({ wordmark: e.target.value }) },
        })
      }))
      rows.push(field('wordmarkSize', function () {
        return h('input', {
          type: 'number',
          value: value(state.wordmarkSize, 0),
          onChange: function (e) { setState({ wordmarkSize: Number(e.target.value) }) },
        })
      }))
      rows.push(field('wordmarkShine', function () {
        return switchEl(state.wordmarkShine === true, function (v) { setState({ wordmarkShine: v }) })
      }, 'wordmarkShineHint'))
      // 系统开了"减少动态效果"就**明确告知**哪些跳过、哪些照常 —— 不许静默
      try {
        if (globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          rows.push(h('div', { key: 'rmNote', style: { fontSize: 12, opacity: 0.7, margin: '-4px 0 10px' } }, t('rmNote')))
        }
      } catch (e) { /* 读不到就不提示 */ }
      rows.push(field('wordmarkShineColor', function () {
        // 选色盘 + 一个可粘贴十六进制的文本框：前者好点，后者能精确输入
        var hex = String(value(state.wordmarkShineColor, '#8ff0ff'))
        return h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('input', {
            type: 'color',
            value: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#8ff0ff',
            onChange: function (e) { setState({ wordmarkShineColor: e.target.value }) },
            style: { width: 44, height: 28, padding: 0, cursor: 'pointer' },
          }),
          h('input', {
            type: 'text',
            value: hex,
            onChange: function (e) { setState({ wordmarkShineColor: e.target.value }) },
            style: { width: 120 },
          }))
      }))
      rows.push(field('bgColor', function () {
        // 与流光颜色同一套：调色盘 + 可粘贴十六进制的文本框
        var hex = String(value(state.bgColor, ''))
        return h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('input', {
            type: 'color',
            value: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#0a1c26',
            onChange: function (e) { setState({ bgColor: e.target.value }) },
            style: { width: 44, height: 28, padding: 0, cursor: 'pointer' },
          }),
          h('input', {
            type: 'text',
            value: hex,
            placeholder: '留空 = 不用纯色',
            onChange: function (e) { setState({ bgColor: e.target.value }) },
            style: { width: 140 },
          }))
      }))
      rows.push(field('bg', function () {
        return h('input', {
          type: 'text',
          value: value(state.bg, ''),
          placeholder: '例如 ~/bg.png 或 /path/to/boot.jpg',
          onChange: function (e) { setState({ bg: e.target.value }) },
        })
      }))
      rows.push(field('bgDim', function () {
        return h('input', {
          type: 'number',
          value: value(state.bgDim, 60),
          onChange: function (e) { setState({ bgDim: Number(e.target.value) }) },
        })
      }))
      rows.push(field('clips', function () {
        return h('textarea', {
          rows: 4, style: { width: '100%' },
          value: Array.isArray(state.clips) ? state.clips.join('\n') : '',
          onChange: function (e) { setState({ clips: e.target.value.split('\n').map(function (s) { return s.trim() }).filter(Boolean) }) },
        })
      }))

      var buttons = h('div', { style: { display: 'flex', gap: 8, marginTop: 12 } },
        h('button', { type: 'button', disabled: busy === true, onClick: save }, t('save')),
        h('button', { type: 'button', disabled: busy === true, onClick: reload }, t('reload')),
        h('button', { type: 'button', disabled: busy === true, onClick: diagnose }, t('diagnose')))

      var problems = []
      if (status && Array.isArray(status.problems) && status.problems.length > 0) {
        problems.push(h('div', { key: 'p', style: { marginTop: 12, color: '#e6a23c', fontSize: 13 } },
          t('problems') + '：',
          h('ul', { style: { margin: '4px 0 0 18px' } }, status.problems.map(function (p, i) { return h('li', { key: i }, p) }))))
      }
      if (status) {
        problems.push(h('div', { key: 's', style: { marginTop: 12, fontSize: 12, opacity: 0.75 } },
          t('configPath') + '：' + status.configPath,
          h('br'),
          t('clipsFound') + '：' + (Array.isArray(status.clips) ? status.clips.length : 0)))
        if (status.effective && Array.isArray(status.clips)) {
          problems.push(h('ul', { key: 'c', style: { margin: '4px 0 0 18px', fontSize: 12, opacity: 0.75 } },
            status.clips.slice(0, 20).map(function (c) {
              return h('li', { key: c.name },
                c.name + ' · ' + (c.bytes === null || c.bytes === undefined ? '大小未知' : Math.round(c.bytes / 1048576 * 10) / 10 + ' MB')
                + (c.faststart === false ? ' · ⚠ 未优化（moov 在尾部）' : ''))
            })))
        }
      }

      // ⚠ **不要在这里再画标题**：宿主要按注册时给的 label() 渲染栏目标题（截图里因此出现过两个"启动画面"）。
      // 这里只留说明段。
      return h('div', { style: { maxWidth: 720 } },
        h('div', { style: { fontSize: 13, opacity: 0.65, lineHeight: 1.6, marginBottom: 16 } }, t('intro')),
        h('div', {
          style: {
            border: hairline, borderRadius: 12, padding: '2px 14px',
            background: 'rgba(127,127,127,.06)',
          },
        }, rows),
        buttons,
        message === '' ? null : h('div', { style: { marginTop: 10, fontSize: 13 } }, message),
        h('div', { style: { marginTop: 12, fontSize: 12, opacity: 0.55 } },
          t('clientLoadedAt') + ' ' + new Date(CLIENT_LOADED_AT).toLocaleTimeString()),
        problems)
    }

    function Panel(props) {
      var React = props.React
      var h = React.createElement
      var t = props.t
      var state = props.state
      var setState = props.setState
      var status = props.status
      var busy = props.busy
      var message = props.message
      var save = props.save
      var reload = props.reload
      var diagnose = props.diagnose
      // 不在这里画标题：宿主要按注册时给的 label() 渲染栏目标题，自己再画一个就会出现两个"启动画面"。
      return h('section', { style: { padding: '4px 0' } },
        h(Controls, { React: React, t: t, state: state, setState: setState, status: status, busy: busy, message: message, save: save, reload: reload, diagnose: diagnose }))
    }

    /* --------------------------------------------------------- 状态与注册 */

    /** 一个最小的状态源：读一次配置 + 体检，写只走一个入口。 */
    function makeStore() {
      var listeners = []
      var state = { phase: 'loading', effective: {}, status: null, message: '', busy: false }
      function emit() { listeners.forEach(function (fn) { try { fn() } catch (e) { /* 忽略 */ } }) }
      return {
        get: function () { return state },
        subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn }) } },
        set: function (patch) { state = Object.assign({}, state, patch); emit() },
        load: async function () {
          try {
            var cfg = await readConfig()
            var st = await readStatus()
            state = Object.assign({}, state, { phase: 'ready', effective: cfg.effective, status: st, message: '', busy: false })
            log('配置已读取（来源 ' + cfg.source + '，素材 ' + (st.clips || []).length + ' 段）')
            if (Array.isArray(st.problems) && st.problems.length > 0) warn('体检发现 ' + st.problems.length + ' 项：' + st.problems[0])
          } catch (error) {
            state = Object.assign({}, state, { phase: 'error', message: '读取失败：' + String(error && error.message ? error.message : error) })
            warn('读取配置/体检失败', error)
          }
          emit()
        },
        save: async function () {
          state = Object.assign({}, state, { busy: true, message: '' }); emit()
          var e = state.effective
          try {
            var out = await writeConfig({
              enabled: e.enabled, fadeMs: e.fadeMs, enterMode: e.enterMode,
              holdMs: e.holdMs, dir: e.dir, clips: e.clips,
              sound: e.sound, volume: e.volume,
              mode: e.mode, lineGapMs: e.lineGapMs, wordmark: e.wordmark,
              bg: e.bg, bgColor: e.bgColor, bgDim: e.bgDim,
              wordmarkSize: e.wordmarkSize, wordmarkShine: e.wordmarkShine,
              wordmarkShineColor: e.wordmarkShineColor,
            })
            state = Object.assign({}, state, { busy: false, effective: out.effective, message: '已保存（刷新页面生效）' })
            log('配置已保存')
            await this.load()
          } catch (error) {
            state = Object.assign({}, state, { busy: false, message: String(error && error.message ? error.message : error) })
            warn('保存失败', error)
            emit()
          }
        },
        diagnose: async function () {
          try {
            var st = await readStatus()
            state = Object.assign({}, state, { status: st, message: st.ok ? '体检通过' : '体检发现 ' + st.problems.length + ' 项' })
            log('体检完成：' + (st.ok ? '通过' : st.problems.join('；')))
          } catch (error) {
            state = Object.assign({}, state, { message: '体检失败：' + String(error && error.message ? error.message : error) })
            warn('体检失败', error)
          }
          emit()
        },
      }
    }

    exports.apply = function apply(ctx) {
      // ① 先报到（面板在等这个信号），且这一步绝不能因为后面的注册失败而漏掉。
      try {
        var overlay = globalThis.__BOOT_SPLASH__
        if (overlay && typeof overlay.clientReady === 'function') {
          overlay.clientReady()
          log('已向开机面板报到（clientReady）')
        } else {
          log('没有开机面板（宿主没注入或总开关是关的），仅注册设置界面')
        }
      } catch (error) { warn('报到失败（不影响设置界面）', error) }

      // ② 设置界面。React 从浏览器模块表里取，无需自带依赖。
      try {
        var React = require('react')
        if (React === null || React === undefined || typeof React.createElement !== 'function') {
          warn('拿不到 react ⇒ 设置界面不注册（功能本身不受影响）')
          return
        }
        if (ctx === undefined || ctx === null || typeof ctx.inject !== 'function') {
          warn('没有 ctx.inject ⇒ 设置界面不注册')
          return
        }

        var store = makeStore()
        var copy = COPY
        var boundLocale = null

        ctx.inject(['slots', 'locale'], function (owner) {
          var slots = owner.get ? owner.get('slots') : owner.slots
          var locale = owner.get ? owner.get('locale') : owner.locale
          if (slots === undefined || slots === null || typeof slots.register !== 'function') {
            warn('slots 服务拿不到 ⇒ 设置界面不注册')
            return
          }
          var t = function (key) {
            var dict = boundLocale === 'en' ? copy.en : copy.zh
            return dict[key] === undefined ? key : dict[key]
          }
          if (locale && typeof locale.register === 'function' && typeof owner.effect === 'function') {
            owner.effect(function () { return locale.register(NS, { zh: copy.zh, en: copy.en }) }, 'boot-splash: dictionaries')
            try {
              var snap = typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : null
              boundLocale = snap && snap.language ? String(snap.language).slice(0, 2) : null
            } catch (e) { boundLocale = null }
          }

          function Face(Component) {
            return function FaceComponent() {
              var state = React.useState(store.get())[0]
              var setTick = React.useState(0)[1]
              React.useEffect(function () { return store.subscribe(function () { setTick(function (n) { return n + 1 }) }) }, [])
              var st = store.get()
              var setState = function (patch) {
                store.set({ effective: Object.assign({}, st.effective, patch), message: '' })
              }
              return React.createElement(Component, {
                React: React, t: t, state: st.effective, setState: setState,
                status: st.status, busy: st.busy, message: st.message,
                save: function () { void store.save() },
                reload: function () { void store.load() },
                diagnose: function () { void store.diagnose() },
              })
            }
          }

          void store.load()

          // 通路 A：设置整页（已验证可渲染的写法）
          try {
            slots.inject('settings.section', function () {
              return slots.register({
                name: 'settings.section',
                id: PKG,
                order: 40,
                label: function () { return t('nav') },
                locale: NS,
              }, Face(Panel))
            })
            log('已注册到 settings.section')
          } catch (error) { warn('注册 settings.section 失败', error) }

          // 通路 B：插件页里按包名分组的配置位（keyed 槽）。
          // ⚠️ 2026-10-02 真机实测：**必须用 slots.inject 等槽出现**，再在回调里 register。
          // 直接 register 会抛 `slot "plugins.bundle.config" is not declared (a parent entry's
          // children table must declare it)` —— 该槽由插件页那个父条目声明为子槽，页面没挂上时不存在。
          try {
            slots.inject('plugins.bundle.config', function () {
              return slots.register({ name: 'plugins.bundle.config', key: PKG }, Face(Panel))
            })
            log('已注册到 plugins.bundle.config（inject + register + key）')
          } catch (error) {
            warn('插件页通路注册失败（设置整页仍可用）', error)
          }
        })
      } catch (error) {
        warn('设置界面接线失败（功能本身不受影响）', error)
      }
    }

    return module.exports
  },
})
