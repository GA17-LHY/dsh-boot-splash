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
        dir: '素材目录（留空＝只有渐变底）',
        clips: '参与轮播的文件名（每行一个；留空＝目录内全部）',
        save: '保存',
        reload: '重新读取',
        saved: '已保存',
        diagnose: '体检',
        problems: '发现的问题',
        none: '没有发现问题',
        configPath: '配置文件',
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
        dir: 'Clip directory (empty = gradient only)',
        clips: 'File names in rotation (one per line; empty = all in dir)',
        save: 'Save',
        reload: 'Reload',
        saved: 'Saved',
        diagnose: 'Diagnose',
        problems: 'Problems',
        none: 'No problems found',
        configPath: 'Config file',
        clipsFound: 'Clips found',
        status: 'Runtime state',
        diag: 'Run diagnosis',
      },
    }

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
        throw new Error('保存被拒：' + (body.error || ('HTTP ' + r.status)) + (body.problems ? '（' + body.problems.join('；') + '）' : ''))
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
      var setState = props.setState
      var save = props.save
      var reload = props.reload
      var diagnose = props.diagnose
      var busy = props.busy
      var status = props.status
      var message = props.message

      var field = function (key, render) {
        return h('label', { key: key, style: { display: 'block', margin: '10px 0' } },
          h('div', { style: { fontSize: 12, opacity: 0.7, marginBottom: 4 } }, t(key)),
          render())
      }

      var rows = []
      rows.push(field('enabled', function () {
        return h('input', {
          type: 'checkbox',
          checked: state.enabled === true,
          onChange: function (e) { setState({ enabled: e.target.checked }) },
        })
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
          type: 'text', style: { width: '100%' }, placeholder: 'D:\\videos',
          value: value(state.dir, ''),
          onChange: function (e) { setState({ dir: e.target.value }) },
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

      return h('div', { style: { maxWidth: 640 } },
        h('div', { style: { fontSize: 13, opacity: 0.75, marginBottom: 8 } }, t('intro')),
        rows,
        buttons,
        message === '' ? null : h('div', { style: { marginTop: 10, fontSize: 13 } }, message),
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
      return h('section', { style: { padding: '4px 0' } },
        h('h2', { style: { fontSize: 16, margin: '0 0 10px' } }, t('title')),
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
              mode: e.mode, lineGapMs: e.lineGapMs,
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
