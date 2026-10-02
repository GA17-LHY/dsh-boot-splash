/**
 * boot-splash · 开机面板（浏览器侧，注入到 <head> 的最前面）
 *
 * 这段代码必须**在外壳模块之前**跑完，所以：不 import、不用框架、不依赖 DOM 已就绪。
 * 三条纪律：
 *  ① **绝不把你卡住**：清单拉不到、没有素材、片子播不出来、外壳迟迟不就绪 —— 每条路
 *     都有上界，到点必然放行（最坏情况是"点一下就进"，再差也有绝对上限强制进入）。
 *  ② **失败必须看得见**：任何异常都会落到提示行上（而不是静默留一个渐变底）。
 *  ③ **不吃缓存**：素材请求失败/被替换时立刻 abort，且宿主那边一律 no-store。
 *
 * 与客户端半侧的握手：外壳就绪后客户端插件会调 `globalThis.__BOOT_SPLASH__.clientReady()`。
 */
(function () {
  'use strict'

  var cfg = globalThis.__BOOT_SPLASH_CFG__
  if (cfg === null || typeof cfg !== 'object') return       // 宿主没注入 ⇒ 什么都不做
  if (globalThis.__BOOT_SPLASH__) return                    // 只装一次

  var STYLE_ID = 'boot-splash-style'
  var FADE = typeof cfg.fadeMs === 'number' ? cfg.fadeMs : 2000
  var MODE = cfg.enterMode === 'click' || cfg.enterMode === 'end' ? cfg.enterMode : 'tail'
  var HOLD = typeof cfg.holdMs === 'number' ? cfg.holdMs : 15000
  var ABSOLUTE_CAP = HOLD + 20000                          // 绝对上限：再慢也放行
  var PROBLEMS = Array.isArray(cfg.problems) ? cfg.problems.slice(0, 6) : []

  // 声音三种模式：'auto' 先试带声自动播放（被浏览器拒就退回静音 + 提示）／
  // 'gesture'（默认）静音起播、第一下点击开声／'mute' 始终静音且不提示开声。
  var SOUND = cfg.sound === 'auto' || cfg.sound === 'mute' ? cfg.sound : 'gesture'
  var VOLUME = typeof cfg.volume === 'number' && cfg.volume >= 0 && cfg.volume <= 100 ? cfg.volume / 100 : 1

  var state = {
    clipDone: false,
    ready: false,          // 外壳（客户端插件）回来报到了
    leaving: false,
    entered: false,
    revealed: false,
    hint: '',
  }

  var css = [
    // 覆盖层本身铺满全屏，但**文字不进画面中央**——提示与按钮都挪到左下角。
    '.boot-splash{position:fixed;inset:0;z-index:2147483646;display:block;',
    'background:radial-gradient(120% 120% at 50% 30%,#123a4d 0%,#0a1c26 55%,#050d12 100%);',
    'transition:opacity var(--bs-fade,2000ms) ease;opacity:1}',
    '.boot-splash[data-leaving="1"]{opacity:0}',
    // 顶部"标题栏条"：Windows 的窗口按钮是系统 overlay（透明底 + 浅色主题下近黑图标），
    // 全屏覆盖层会把它们衬成黑按钮 ⇒ 这条让出来，并用宿主自己的 chrome 底色兜住。
    // pointer-events:none ⇒ 点到那一带会透给宿主自己的 drag region（窗口照样能拖）。
    '.boot-splash-top{position:fixed;left:0;right:0;top:0;z-index:2147483647;pointer-events:none;display:none;',
    'background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base,transparent))}',
    '.boot-splash-top[data-on="1"]{display:block}',
    '.boot-splash video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 400ms ease}',
    '.boot-splash[data-revealed="1"] video{opacity:1}',
    '.boot-splash-ui{position:absolute;left:22px;bottom:18px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;',
    'max-width:52vw;color:#dff1f7;font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif;text-shadow:0 1px 3px rgba(0,0,0,.6);',
    'text-align:left;pointer-events:none}',
    '.boot-splash[data-revealed="1"] .boot-splash-ui{opacity:.5}',
    '.boot-splash-hint{text-align:left}',
    '.boot-splash-problems{font-size:12px;opacity:.8;text-align:left}',
    '.boot-splash-btn{pointer-events:auto;border:1px solid rgba(223,241,247,.45);background:rgba(5,13,18,.45);',
    'color:#dff1f7;border-radius:999px;padding:4px 12px;font:12px/1.4 inherit;cursor:pointer}',
  ].join('')

  function part(tag, cls, text) {
    var el = document.createElement(tag)
    if (cls) el.className = cls
    if (text !== undefined) el.textContent = text
    return el
  }

  var nodes = {}

  function build() {
    var style = document.getElementById(STYLE_ID)
    if (style === null) {
      style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = css
      ;(document.head || document.documentElement).appendChild(style)
    }
    var root = part('div', 'boot-splash')
    root.setAttribute('data-revealed', '0')
    root.style.setProperty('--bs-fade', FADE + 'ms')

    var ui = part('div', 'boot-splash-ui')
    var hint = part('div', 'boot-splash-hint', '正在准备…')
    var problems = part('div', 'boot-splash-problems', PROBLEMS.length > 0 ? '⚠ ' + PROBLEMS.join('；') : '')
    var sound = null
    if (SOUND !== 'mute') {
      sound = part('button', 'boot-splash-btn', '🔊 开声音')
      sound.type = 'button'
      sound.setAttribute('data-bs-sound', '1')
    }
    ui.appendChild(hint)
    if (PROBLEMS.length > 0) ui.appendChild(problems)
    if (sound) ui.appendChild(sound)
    root.appendChild(ui)

    // 标题栏条（见 titlebarInset 的说明）：与覆盖层同级，固定贴顶。
    var strip = part('div', 'boot-splash-top')
    strip.setAttribute('data-on', '0')

    var parent = document.body || document.documentElement
    parent.appendChild(strip)
    parent.appendChild(root)
    applyTitlebarInset(root, strip)
    watchTitlebar(root, strip)
    nodes = { root: root, ui: ui, hint: hint, problems: problems, sound: sound, video: null, strip: strip }
    return nodes
  }

  /**
   * Windows 桌面端的窗口按钮（最小化/最大化/关闭）是**系统画的 titleBarOverlay**：
   * 图标色取自宿主探测到的 chrome 调色板（浅色主题是近黑 `#0f1115`），而背景在开机早期
   * 是透明的 ⇒ 我们的全屏覆盖层会把它们衬成"黑底黑图标"（用户 2026-10-02 实际报的现象）。
   * 所以：**把标题栏那一条让出来**，并用宿主自己的 chrome 底色兜住它。
   * 全屏态没有标题栏 ⇒ 不偏移。
   * @returns {number} 需要让出的高度（px）。
   */
  function titlebarInset() {
    try {
      var root = document.documentElement
      if (root.hasAttribute('data-fullscreen')) return 0
      if (!root.hasAttribute('data-windows-titlebar')) return 0
      var raw = getComputedStyle(root).getPropertyValue('--dsh-windows-titlebar-height').trim()
      var n = parseFloat(raw)
      return isFinite(n) && n > 0 ? n : 40
    } catch (error) {
      return 0
    }
  }

  function applyTitlebarInset(rootEl, strip) {
    var inset = titlebarInset()
    if (rootEl) rootEl.style.top = inset > 0 ? inset + 'px' : '0px'
    if (strip) {
      strip.style.height = inset > 0 ? inset + 'px' : '0px'
      strip.setAttribute('data-on', inset > 0 ? '1' : '0')
    }
    return inset
  }

  /** 宿主可能稍后才打上 `data-windows-titlebar` 或算出高度 ⇒ 头三秒盯一下。 */
  function watchTitlebar(rootEl, strip) {
    var tries = 0
    var timer = globalThis.setInterval(function () {
      tries += 1
      applyTitlebarInset(rootEl, strip)
      if (tries >= 20 || state.leaving) globalThis.clearInterval(timer)
    }, 150)
  }

  function setHint(text) {
    state.hint = text
    if (nodes.hint) nodes.hint.textContent = text
  }

  function note(text) {
    PROBLEMS.push(text)
    if (nodes.problems) nodes.problems.textContent = '⚠ ' + PROBLEMS.join('；')
    try { console.warn('boot-splash: ' + text) } catch (e) { /* 忽略 */ }
  }

  /* ------------------------------------------------------------------ 进入 */

  function maybeEnter() {
    if (state.entered || state.leaving) return
    if (MODE === 'click') return                    // 点才进：只有手势能放行
    if (!state.clipDone) return
    if (!state.ready) { setHint('启动较慢，就绪后自动进入（点一下可立即进入）'); return }
    enter()
  }

  function enter() {
    if (state.entered) return
    state.entered = true
    state.leaving = true
    if (nodes.root) nodes.root.setAttribute('data-leaving', '1')
    try { globalThis.__BOOT_SPLASH_STATE__ = 'leaving' } catch (e) { /* 忽略 */ }
    globalThis.setTimeout(function () {
      if (nodes.video) { try { nodes.video.pause() } catch (e) { /* 忽略 */ } }
      if (nodes.root && nodes.root.parentNode) nodes.root.parentNode.removeChild(nodes.root)
      if (nodes.strip && nodes.strip.parentNode) nodes.strip.parentNode.removeChild(nodes.strip)
      try { globalThis.__BOOT_SPLASH_STATE__ = 'done' } catch (e) { /* 忽略 */ }
    }, FADE + 60)
  }

  /* ------------------------------------------------------------------ 素材 */

  var TRIES = 0
  var MAX_TRIES = 3

  function pickClip(clips) {
    if (clips.length === 0) return null
    var idx = Math.floor(Math.random() * clips.length)
    return clips[idx]
  }

  function playClip(clip) {
    var video = document.createElement('video')
    video.muted = true
    // 'auto'：先尝试带声播放（Chromium 只在"此前与该站交互过"等情形才放行）；
    // 被拒由下面的 play() catch 退回静音，绝不影响画面。
    if (SOUND === 'auto' && VOLUME > 0) video.muted = false
    video.volume = VOLUME
    video.autoplay = true
    video.playsInline = true
    video.preload = 'auto'
    video.setAttribute('playsinline', '')
    video.src = clip.src
    nodes.root.insertBefore(video, nodes.root.firstChild)
    nodes.video = video
    state.revealed = false
    nodes.root.setAttribute('data-revealed', '0')

    var settled = false
    var reveal = function () {
      if (settled) return
      // 判据是"解出了画面"（readyState >= 2），不是 play() 的 promise 兑现。
      if (video.readyState < 2) return
      settled = true
      state.revealed = true
      nodes.root.setAttribute('data-revealed', '1')
      setHint(idleHint())
    }
    video.addEventListener('loadeddata', reveal)
    video.addEventListener('canplay', reveal)
    video.addEventListener('timeupdate', function () {
      reveal()
      // 片尾：留出淡出时间就当作"可以进了"
      if (MODE === 'tail' && video.duration && video.currentTime > 0) {
        var remainMs = (video.duration - video.currentTime) * 1000
        if (remainMs <= FADE + 300) { state.clipDone = true; maybeEnter() }
      }
    })
    video.addEventListener('ended', function () { state.clipDone = true; maybeEnter() })
    video.addEventListener('error', function () {
      fail('这段素材播不出来（' + clip.name + '）')
    })

    var played = video.play()
    if (played && typeof played.catch === 'function') {
      played.catch(function (reason) {
        // 自动播放被拒/解码被拒：不算致命，继续等 reveal 或超时
        if (!video.muted) {
          video.muted = true          // 'auto' 被拒 ⇒ 退回静音，并让提示告诉用户"点一下可开声"
          state.audioOn = false
          note('带声自动播放被拒（' + (reason && reason.name ? reason.name : 'unknown') + '）⇒ 已退回静音')
          setHint(idleHint())
        } else {
          note('自动播放被拒（' + (reason && reason.name ? reason.name : 'unknown') + '），仍等待画面')
        }
      })
    }

    // 6 秒还没画面 ⇒ 换下一段；换完还是不行 ⇒ 认输入场（不卡人）
    globalThis.setTimeout(function () {
      if (settled || state.leaving) return
      TRIES += 1
      if (TRIES < MAX_TRIES) {
        fail('这段素材 6 秒没出画面（' + clip.name + '），已换下一段')
        if (nodes.video && nodes.video.parentNode) nodes.video.parentNode.removeChild(nodes.video)
        start()
      } else {
        fail('连续 ' + MAX_TRIES + ' 段素材都没出画面 ⇒ 只用渐变底')
        state.clipDone = true
        setHint('素材有问题 · 就绪后自动进入')
        maybeEnter()
      }
    }, 6000)
  }

  function fail(text) {
    note(text)
    state.hint = text
  }

  function start() {
    if (state.leaving) return
    fetch(cfg.manifest, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)) })
      .then(function (data) {
        var clips = data && Array.isArray(data.clips) ? data.clips : []
        if (Array.isArray(data.problems) && data.problems.length > 0) {
          for (var i = 0; i < data.problems.length && i < 3; i += 1) note(data.problems[i])
        }
        if (clips.length === 0) {
          setHint('素材池是空的 · 就绪后自动进入')
          state.clipDone = true
          maybeEnter()
          return
        }
        playClip(pickClip(clips))
      })
      .catch(function (error) {
        note('素材清单拉不到：' + String(error && error.message ? error.message : error))
        setHint('素材清单拉不到 · 就绪后自动进入')
        state.clipDone = true
        maybeEnter()
      })
  }

  /* ------------------------------------------------------------ 手势与上界 */

  /** 左下角提示文案：把"静音/已开声"说清楚，用户才知道第一下点击是干什么的。 */
  function idleHint() {
    var entry = MODE === 'click' ? '点击进入' : '播完自动进入 · 点一下提前进'
    if (SOUND === 'mute') return entry                        // 参数设成静音：完全不提开声
    var muted = !nodes.video || nodes.video.muted
    if (!muted) return entry
    return MODE === 'click' ? '点一下开声音 · 再点进入' : '点一下开声音 · 播完自动进入'
  }

  /**
   * 声音的**唯一入口**：`setSound(true|false)`。
   * 开声必须在用户手势里（Chromium 策略）；被拒就**退回静音并把原因写进提示**（不静默）。
   */
  function setSound(on) {
    var video = nodes.video
    if (!video) return
    if (!on) {
      video.muted = true
      state.audioOn = false
      if (nodes.sound) nodes.sound.textContent = '🔊 开声音'
      setHint(idleHint())
      return
    }
    video.muted = false
    video.volume = VOLUME
    var done = function () {
      state.audioOn = true
      if (nodes.sound) nodes.sound.textContent = '🔊 声音已开'
      setHint(idleHint())
    }
    var failed = function (reason) {
      video.muted = true
      state.audioOn = false
      note('开声音被拒（' + (reason && reason.name ? reason.name : 'unknown') + '）')
      setHint(idleHint())
    }
    var played = video.play()
    if (played && typeof played.then === 'function') played.then(done, failed)
    else done()
  }

  /** 事件是不是来自我们自己的 UI（左下角那条）？是的话就不算"全局手势"。 */
  function isOwnUi(event) {
    try {
      var target = event && event.target
      if (!target || !nodes.ui) return false
      return target === nodes.ui || (typeof nodes.ui.contains === 'function' && nodes.ui.contains(target))
    } catch (error) {
      return false
    }
  }

  function onGesture(event) {
    if (state.leaving) return
    // 自己的按钮自己处理 —— 否则窗口级 capture 监听会**先把声音开掉**，按钮的 click 再把它关回去
    // （2026-10-02 用户实测："按了以后声音会有一下，然后马上又变成未开启了"）。
    if (isOwnUi(event)) return
    // 第一下先开声音 —— 与提示文案一致。
    // ⚠️ 2026-10-02 修正：原判据写成 `state.video === null`，而 state 里**根本没有 `video`
    // 字段** ⇒ 条件恒假 ⇒ 这条分支永不执行、动画一直静音（用户报"没有声音了"）。
    if (SOUND !== 'mute' && nodes.video && nodes.video.muted) { setSound(true); return }
    if (MODE === 'click' || state.ready) enter()
    else { state.clipDone = true; setHint('启动较慢，就绪后自动进入') }
  }

  function bind() {
    try {
      globalThis.addEventListener('pointerdown', onGesture, true)
      globalThis.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' || event.key === ' ' || event.key === 'Enter') onGesture(event)
      })
      if (nodes.sound) {
        nodes.sound.addEventListener('click', function (event) {
          event.stopPropagation()
          event.preventDefault()
          // 显式控件：**以当前实际是否静音为准**切换一次（不依赖事件顺序，避免自己被自己的
          // capture 监听抵消）。当前静音 ⇒ 开声；当前有声 ⇒ 静音。
          setSound(nodes.video ? nodes.video.muted : true)
        })
      }
    } catch (e) { /* 绑定失败不致命 */ }
  }

  /* -------------------------------------------------------------- 对外接口 */

  globalThis.__BOOT_SPLASH__ = {
    clientReady: function () {
      state.ready = true
      if (!state.leaving) setHint(idleHint())
      maybeEnter()
    },
    /** 供排查用：一次拿到当前状态与已知问题。 */
    status: function () {
      return {
        mode: MODE, fadeMs: FADE, holdMs: HOLD,
        ready: state.ready, clipDone: state.clipDone, revealed: state.revealed,
        entered: state.entered, hint: state.hint, problems: PROBLEMS.slice(),
        clip: nodes.video ? (nodes.video.currentSrc || '').split('?')[0] : null,
      }
    },
    enter: enter,
  }
  try { globalThis.__BOOT_SPLASH_STATE__ = 'running' } catch (e) { /* 忽略 */ }

  /* ------------------------------------------------------------------ 启动 */

  build()
  bind()
  setHint('正在准备…')
  start()

  // 上界一：到点提示可点击（不自动进，避免盖住还在渲染的界面）
  globalThis.setTimeout(function () {
    if (!state.leaving && !state.ready) setHint('启动较慢，点一下可以立即进入')
  }, HOLD)
  // 上界二：绝对上限 —— 无论发生什么，到点强制放行（绝不把人卡在启动页）
  globalThis.setTimeout(function () {
    if (!state.leaving) { note('到达绝对上限，强制进入'); enter() }
  }, ABSOLUTE_CAP)
}())
