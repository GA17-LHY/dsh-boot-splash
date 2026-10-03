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
  /** 启动画面形态（config.mode）：video / status / both。 */
  var SPLASH = cfg.mode === 'status' || cfg.mode === 'both' ? cfg.mode : 'video'
  /** 状态窗每行**至少**间隔多久露面（config.lineGapMs）。这是回放节奏；行首时间戳仍是实测值。 */
  var LINE_GAP = typeof cfg.lineGapMs === 'number' && cfg.lineGapMs >= 0 && cfg.lineGapMs <= 2000
    ? cfg.lineGapMs : 120
  var SHOW_STATUS = SPLASH !== 'video'
  var SHOW_VIDEO = SPLASH !== 'status'
  if (!SHOW_VIDEO) SOUND = 'mute'        // 没有视频就没有"开声音"这回事
  var VOLUME = typeof cfg.volume === 'number' && cfg.volume >= 0 && cfg.volume <= 100 ? cfg.volume / 100 : 1
  /** 诊断总开关（宿主注入，来自 config.diag）。默认 false ⇒ 本文件不采、不报、不多发一个请求。 */
  var DIAG = cfg.diag === true
  /** 起播前固定等多久（config.delayMs，默认 0 = 原行为）。先只显示渐变底。 */
  var DELAY = typeof cfg.delayMs === 'number' && cfg.delayMs > 0 && cfg.delayMs <= 10000 ? cfg.delayMs : 0

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
    // 启动状态窗：纯文本、无模糊/无动画（理由见 panel.js 里那段注释）
    '.boot-splash-status{position:absolute;inset:0;padding:22px 26px 96px 26px;box-sizing:border-box;',
    'color:#d6ecf5;font:12px/1.6 ui-monospace,Consolas,"Cascadia Mono","Microsoft YaHei",monospace;',
    'pointer-events:none;display:flex;flex-direction:column;gap:8px}',
    '.boot-splash-status-head{color:#8fd3e8;font-weight:600;font-size:13px}',
    '.boot-splash-status-log{flex:1 1 auto;white-space:pre-wrap;overflow:hidden;opacity:.94}',
    '.boot-splash-status-tail{color:#bcd6e2}',
    '.boot-splash-status-tail.ok{color:#8fe3a8}',
    '.boot-splash-status-tail.bad{color:#ffb0b0}',
  ].join('')

  function part(tag, cls, text) {
    var el = document.createElement(tag)
    if (cls) el.className = cls
    if (text !== undefined) el.textContent = text
    return el
  }

  var nodes = {}
  var statusEl = null
  var statusHead = null
  var statusLog = null
  var statusTail = null

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

    if (SHOW_STATUS) {
      statusEl = part('div', 'boot-splash-status')
      statusHead = part('div', 'boot-splash-status-head', '启动状态…')
      statusLog = part('div', 'boot-splash-status-log', '')
      statusTail = part('div', 'boot-splash-status-tail', '')
      statusEl.appendChild(statusHead)
      statusEl.appendChild(statusLog)
      statusEl.appendChild(statusTail)
      root.appendChild(statusEl)
    }

    // 标题栏条（见 titlebarInset 的说明）：与覆盖层同级，固定贴顶。
    var strip = part('div', 'boot-splash-top')
    strip.setAttribute('data-on', '0')

    var parent = document.body || document.documentElement
    parent.appendChild(strip)
    parent.appendChild(root)
    applyTitlebarInset(root, strip)
    watchTitlebar(root, strip)
    nodes = {
      root: root, ui: ui, hint: hint, problems: problems, sound: sound,
      video: null, strip: strip,
      statusEl: statusEl, statusHead: statusHead, statusLog: statusLog, statusTail: statusTail,
    }
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
    // 启动有失败项就不自动进：这个窗口存在的意义之一就是让人看见失败
    if (S && S.failures.length > 0) { setHint('启动有失败项 · 读完后点一下进入'); return }
    // 回放还没追平就先别进：否则后面几行会被一起带走，等于没看见
    if (S && S.revealed < S.lines.length) { setHint('正在逐行回放启动过程…'); return }
    if (!state.ready) { setHint('启动较慢，就绪后自动进入（点一下可立即进入）'); return }
    enter()
  }

  function enter() {
    if (state.entered) return
    state.entered = true
    state.leaving = true
    // 诊断：进入时刻先记一笔，再留 1.2s 让最后一段画面的质量计数器落定后回传。
    diagEvent('enter')
    if (DIAG) globalThis.setTimeout(function () { flushDiag('entered') }, 1200)
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
    state.clipName = clip.name

    // 诊断挂载：**独立**监听，不改上/下任何一条既有逻辑；D 为空（cfg.diag 为假）时整段是空转。
    if (D) {
      var marks = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'ended']
      for (var mi = 0; mi < marks.length; mi += 1) {
        video.addEventListener(marks[mi], (function (name) {
          return function () {
            diagEvent(name)
            if (D && name === 'loadedmetadata' && video.duration) D.durationMs = Math.round(video.duration * 1000)
          }
        }(marks[mi])))
      }
      video.addEventListener('waiting', function () {
        if (!D) return
        D.waiting += 1
        var b = bucket()
        if (b) b.wait += 1
        diagEvent('waiting')
      })
      video.addEventListener('stalled', function () { if (D) D.stalled += 1; diagEvent('stalled') })
      watchFramePacing(video)
    }

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
    if (!SHOW_VIDEO) {
      // status 模式：没有片子可等 ⇒ 立刻算"片完"，进入条件只剩「外壳就绪」
      state.clipDone = true
      statusPush(Date.now(), 'panel', '状态窗模式：不拉素材、不建 video')
      maybeEnter()
      return
    }
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

  /*
   * ⚠ 这里**故意不做**「等 first paint 再起播」那条闸门 —— 2026-10-03 实现过、测过，又撤了。
   * 两条原因都来自实测（六次真实启动，逐次对齐 `playing` 与首个 paint 条目）：
   *
   *  ① **前提不成立**：真正单调对应丢帧的是「起播的绝对时刻」，不是「离首帧多远」——
   *       起播 0.2s → 丢帧 5/193，最长呈现空档 425ms（用户报「开头 1–3 秒顿」）
   *       起播 2.1s → 丢帧 3/193，最长空档 150ms（用户确认「已经不卡了」）
   *       起播 3.0s → 丢帧 0/193，最长空档 95–125ms（两次，均干净）
   *     而首帧时刻本身逐次浮动（3192 / 4216 / 4032ms），与丢帧只是**相关**、不是因果：
   *     有一次起播早于首帧 965ms 仍然 0 丢帧，另一次早 2123ms 掉 3 帧。
   *
   *  ② **判据自身行为无法解释**：某次运行里它在 3002ms 报「首帧已发生」并放行，
   *     可同一份诊断里 `first-paint` 的 `startTime` 是 4032ms（且面板/宿主时钟已对齐核对过）。
   *     一个自己解释不了的判据不该留在代码里。
   *
   * 结论：只用**固定的 `delayMs` 下限**。本机 2000ms 已被用户确认「不卡」（150ms 空档不可感），
   * 3000ms 更稳但要多等一秒。判据请挂在**可感知的量**（最长呈现空档）上，别挂在「丢帧必须为 0」上。
   */

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

  /* -------------------------------------------------------------------- 诊断 */

  /**
   * 诊断只在 `cfg.diag === true` 时干活，只回答一个问题：
   * **开头那几秒的顿，是「数据没到」还是「画面没画出来」**。四路证据各管一段：
   *   · 每秒一桶记 `getVideoPlaybackQuality()` 的**增量**（丢帧落在哪一秒）+ `waiting`/`stalled`（数据没跟上）；
   *   · `requestVideoFrameCallback` 的 `expectedDisplayTime` 间隔（画出来了、但节奏不对）；
   *   · 每 250ms 心跳打一发 `/config.json?hb=1` —— 它是现成路由里最便宜的一个，且排在宿主事件循环上，
   *     所以 /clip 的同步整读一旦开始占住主进程，心跳延迟就会跟着涨（这是它的判据）；
   *   · `PerformanceObserver('longtask')` 记渲染进程主线程被占住多久。
   * 结束时经 `clips.json?diag=<base64url>` 把结果捎回宿主落盘 ——
   * 用 GET + 查询串是**故意**的：GET 不带 Origin，也就不必去碰 config 那两道写守卫。
   */
  var D = null
  var clock = function () {
    return globalThis.performance && globalThis.performance.now ? globalThis.performance.now() : Date.now()
  }

  function startDiag() {
    if (!DIAG || D) return
    D = {
      t0: clock(), events: [], long: [], hb: [], sec: [],
      waiting: 0, stalled: 0, quality: null, prev: null, sent: false,
      win: globalThis.innerWidth + 'x' + globalThis.innerHeight,
      dpr: globalThis.devicePixelRatio || 0,
      // 绝对时刻：宿主侧记录用的是"相对它自己启动"的毫秒，两边原点相差可达数秒。
      // 有了这个绝对值，就能把两半侧的时间轴精确对齐（先前只能靠 /clip 反推，误差不小）。
      t0Epoch: Date.now(),
    }
    try {
      if (globalThis.PerformanceObserver) {
        var po = new globalThis.PerformanceObserver(function (list) {
          var es = list.getEntries()
          for (var i = 0; i < es.length; i += 1) {
            if (D && D.long.length < 80) D.long.push([Math.round(es[i].startTime), Math.round(es[i].duration)])
          }
        })
        po.observe({ entryTypes: ['longtask'] })
      }
    } catch (e) { /* 观测不到不致命 */ }

    // 界面首帧 / 最大内容绘制：判定「顿」是否与界面首次光栅化同期（GPU 侧竞争的判据）。
    D.paint = []
    try {
      if (globalThis.PerformanceObserver) {
        var poPaint = new globalThis.PerformanceObserver(function (list) {
          var es = list.getEntries()
          for (var i = 0; i < es.length; i += 1) {
            if (D && D.paint.length < 20) D.paint.push([es[i].name, Math.round(es[i].startTime)])
          }
        })
        poPaint.observe({ type: 'paint', buffered: true })
        poPaint.observe({ type: 'largest-contentful-paint', buffered: true })
      }
    } catch (e) { /* 忽略 */ }

    D.hbTimer = globalThis.setInterval(function () {
      if (!D || state.leaving || D.hb.length >= 160) return
      var t = clock()
      fetch(cfg.route + '/config.json?hb=1', { cache: 'no-store' })
        .then(function () { if (D) D.hb.push([Math.round(t - D.t0), Math.round(clock() - t)]) })
        .catch(function () { /* 心跳失败不致命 */ })
    }, 250)

    // 可见性时间线：留档页面是否曾被隐藏（起播卡顿排查用）。
    D.vis = []
    D.visPush = function (why) {
      if (!D || D.vis.length >= 40) return
      D.vis.push([why, Math.round(clock() - D.t0), document.visibilityState])
    }
    D.visPush('init')
    try { globalThis.addEventListener('visibilitychange', function () { D.visPush('change') }) } catch (e) { /* 忽略 */ }

    D.tick = globalThis.setInterval(function () { sampleQuality() }, 1000)
  }

  /** 取「当前秒」的桶（诊断时长上限 90s，够覆盖启动期）。 */
  function bucket() {
    if (!D) return null
    var s = Math.floor((clock() - D.t0) / 1000)
    while (D.sec.length <= s && D.sec.length < 90) {
      D.sec.push({ s: D.sec.length, frames: 0, drop: 0, wait: 0, gap: 0, maxGap: 0, vis: document.visibilityState })
    }
    return s < D.sec.length ? D.sec[s] : null
  }

  /** 把累计计数器换算成「这一秒的增量」——这样"顿在第几秒"才是可读的。 */
  function sampleQuality() {
    if (!D || !nodes.video) return
    var q = null
    try { if (nodes.video.getVideoPlaybackQuality) q = nodes.video.getVideoPlaybackQuality() } catch (e) { /* 忽略 */ }
    if (!q) return
    if (D.prev) {
      var b = bucket()
      if (b) {
        b.frames += q.totalVideoFrames - D.prev.total
        b.drop += q.droppedVideoFrames - D.prev.drop
      }
      D.quality = { total: q.totalVideoFrames, dropped: q.droppedVideoFrames, corrupted: q.corruptedVideoFrames }
    }
    D.prev = { total: q.totalVideoFrames, drop: q.droppedVideoFrames }
  }

  /** 帧呈现节奏：两次回调的 expectedDisplayTime 之差超过 1.5 个标称帧长，就算一次「顿」。 */
  function watchFramePacing(video) {
    if (!D || typeof video.requestVideoFrameCallback !== 'function') return
    var nominal = 1000 / 24          // 素材实测 24.000fps；只用于判定间隔异常，不参与播放
    var last = null
    var step = function (t, md) {
      if (!D) return
      if (md && typeof md.expectedDisplayTime === 'number') {
        if (last !== null) {
          var gap = md.expectedDisplayTime - last
          if (gap > nominal * 1.5) {
            var b = bucket()
            if (b) { b.gap += 1; if (gap > b.maxGap) b.maxGap = Math.round(gap) }
          }
        }
        last = md.expectedDisplayTime
      }
      try { video.requestVideoFrameCallback(step) } catch (e) { /* 忽略 */ }
    }
    try { video.requestVideoFrameCallback(step) } catch (e) { /* 忽略 */ }
  }

  /** 记一条媒体事件（时间都相对诊断起点）。 */
  function diagEvent(name) {
    if (!D) return
    if (D.events.length < 60) D.events.push([name, Math.round(clock() - D.t0)])
  }

  function b64url(text) {
    try {
      var s = globalThis.btoa(unescape(encodeURIComponent(text)))
      return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    } catch (e) { return '' }
  }

  /** 把结果捎回宿主（宿主落盘 `$DSH_HOME/boot-splash-diag.json`）。只发一次。 */
  function flushDiag(reason) {
    if (!D || D.sent) return
    D.sent = true
    try { if (D.hbTimer) globalThis.clearInterval(D.hbTimer) } catch (e) { /* 忽略 */ }
    try { if (D.tick) globalThis.clearInterval(D.tick) } catch (e) { /* 忽略 */ }
    sampleQuality()
    var bufferedEnd = -1
    try {
      var bf = nodes.video && nodes.video.buffered
      if (bf && bf.length > 0) bufferedEnd = Math.round(bf.end(bf.length - 1) * 1000)
    } catch (e) { /* 忽略 */ }
    var nav = null
    try {
      var navEntries = globalThis.performance.getEntriesByType ? globalThis.performance.getEntriesByType('navigation') : []
      if (navEntries && navEntries[0]) {
        nav = {
          responseEnd: Math.round(navEntries[0].responseEnd),
          dcl: Math.round(navEntries[0].domContentLoadedEventEnd),
          load: Math.round(navEntries[0].loadEventEnd),
        }
      }
    } catch (e) { /* 忽略 */ }
    var report = {
      v: 1, reason: reason, win: D.win, dpr: D.dpr,
      sound: SOUND, mode: MODE, fadeMs: FADE, delayMs: DELAY, t0Epoch: D.t0Epoch,
      clip: state.clipName || '', durationMs: D.durationMs || 0, bufferedEnd: bufferedEnd,
      paint: D.paint, nav: nav,
      waiting: D.waiting, stalled: D.stalled,
      events: D.events, sec: D.sec, hb: D.hb, long: D.long,
      vis: D.vis,
      status: S ? {
        bootSeen: S.bootSeen, bootTotal: S.bootTotal, bootDetail: S.bootDetail,
        arc: S.arc, shellText: S.shellText, failures: S.failures,
        lines: S.lines.slice(-14),
      } : null,
      quality: D.quality, tries: TRIES,
    }
    var payload = b64url(JSON.stringify(report))
    if (payload === '' || payload.length > 11000) return
    try {
      fetch(cfg.manifest + '?diag=' + payload, { cache: 'no-store', keepalive: true })
        .catch(function () { /* 回传失败不致命 */ })
    } catch (e) { /* 忽略 */ }
    try { console.info('boot-splash diag', report) } catch (e) { /* 忽略 */ }
  }

  /* -------------------------------------------------------------- 启动状态窗 */

  /**
   * 启动状态窗（config.mode = status / both）。
   *
   * 铁律：**只显示实测到的**，每条都标来源；没读到就写「不确定」，绝不编。
   *   · host     宿主进程侧事件（带绝对时间戳，随 cfg 注入）
   *   · panel    面板自身进度
   *   · shell    DSH 外壳的启动页 `[data-dsh-boot]` —— 真实激活进度，但**属内部实现**，读不到就降级
   *   · net      资源加载（performance.getEntriesByType('resource')）
   *   · renderer 渲染里程碑（DCL / load / 首帧 / 外壳就绪）
   *
   * 时间轴一律用**绝对时刻**（Date.now()）：面板的 performance.now() 与宿主进程的时钟原点
   * 能差 1.4–2.1 秒（2026-10-03 实测），用相对时钟排序会把先后显示错。
   *
   * 刻意做得**廉价**：纯文本 + 200ms 一次、只在文本变化时写 DOM。不做模糊/渐变/过渡/动画——
   * 那是 2026-10-03 花了一整天解决掉的坑（启动期抢合成资源导致掉帧），别把它挖回来。
   */
  var S = null
  var STATUS_TICK = 200

  function statusPush(abs, src, text) {
    if (!S || abs === undefined || abs === null) return
    var last = S.lines[S.lines.length - 1]
    if (last && last.text === text) return
    S.lines.push({ abs: abs, src: src, text: text })
    if (S.lines.length > 60) S.lines.shift()
  }

  /** 把 shell 启动页的进度弧换算成比例：arc = 72 + 比例×216（外壳 bundle 里就是这么 setProperty 的）。 */
  function shellArc() {
    try {
      var sp = document.querySelector('[data-dsh-boot-spinner]')
      if (!sp) return null
      var raw = sp.style.getPropertyValue('--dsh-boot-arc') ||
        (globalThis.getComputedStyle ? getComputedStyle(sp).getPropertyValue('--dsh-boot-arc') : '')
      var deg = parseFloat(String(raw))
      if (!isFinite(deg)) return null
      return Math.max(0, Math.min(1, (deg - 72) / 216))
    } catch (e) { return null }
  }

  function startStatus() {
    if (!SHOW_STATUS || S) return
    S = {
      t0: Date.now(), lines: [], lastBody: null, lastHead: null, lastTail: null,
      bootSeen: false, bootTotal: 0, bootDetail: '',
      arc: null, arcShown: null, shellText: '', shellSeen: false, shellGone: false,
      resSeen: {}, failures: [], fcp: false,
      revealed: 0, lastRevealAt: 0,
    }
    var hb = Array.isArray(cfg.bootEvents) ? cfg.bootEvents : []
    for (var i = 0; i < hb.length; i += 1) statusPush(hb[i].at, 'host', String(hb[i].label))
    statusPush(S.t0, 'panel', '面板脚本开始执行')
    var anchorAt = typeof cfg.hostStartedAt === 'number' ? cfg.hostStartedAt : null
    if (anchorAt !== null && !hb.length) statusPush(anchorAt, 'host', '宿主进程启动（无更早事件可读）')
    try {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { statusPush(Date.now(), 'renderer', 'DOMContentLoaded') })
        globalThis.addEventListener('load', function () { statusPush(Date.now(), 'renderer', 'load（页面资源加载完）') })
      } else {
        statusPush(Date.now(), 'renderer', 'DOMContentLoaded（面板执行时已完成）')
      }
    } catch (e) { /* 忽略 */ }
    try {
      if (globalThis.PerformanceObserver) {
        var po = new globalThis.PerformanceObserver(function (list) {
          var es = list.getEntries()
          for (var j = 0; j < es.length; j += 1) {
            if (S && !S.fcp) { S.fcp = true; statusPush(Date.now(), 'renderer', es[j].name + '（首次绘制）') }
          }
        })
        po.observe({ type: 'paint', buffered: true })
      }
    } catch (e) { /* 忽略 */ }
    S.timer = globalThis.setInterval(statusTick, STATUS_TICK)
    statusTick()
  }

  /** 读启动图。形状以官方解析器为准：{rev, entries:[{id,url,rev,…}], batches:[{phase,url,rev,entries}]}。 */
  function readBootGraph() {
    if (!S || S.bootSeen) return
    var g = null
    try { g = globalThis.__DSH_BOOT__ } catch (e) { g = null }
    if (g === null || typeof g !== 'object' || !Array.isArray(g.entries)) return
    S.bootSeen = true
    S.bootTotal = g.entries.length
    var bs = 0
    var ap = 0
    if (Array.isArray(g.batches)) {
      for (var i = 0; i < g.batches.length; i += 1) {
        var b = g.batches[i] || {}
        var n = Array.isArray(b.entries) ? b.entries.length : 0
        if (b.phase === 'bootstrap') bs += n
        else if (b.phase === 'application') ap += n
      }
    }
    S.bootDetail = 'bootstrap ' + bs + ' / application ' + ap
    statusPush(Date.now(), 'shell', '启动图到手：' + S.bootTotal + ' 条客户端插件（' + S.bootDetail + '）')
  }

  function statusTick() {
    if (!S || state.leaving) return
    readBootGraph()
    try {
      var root = document.querySelector('[data-dsh-boot]')
      if (root) {
        if (!S.shellSeen) { S.shellSeen = true; statusPush(Date.now(), 'shell', 'shell 启动页出现') }
        var arc = shellArc()
        if (arc !== null) {
          if (S.arcShown === null || Math.abs(arc - S.arcShown) >= 0.05) {
            S.arcShown = arc
            statusPush(Date.now(), 'shell', '激活进度 ' + Math.round(arc * 100) + '%')
          }
          S.arc = arc
        }
        var txt = String(root.textContent || '').replace(/\s+/g, ' ').trim()
        if (txt !== S.shellText) {
          S.shellText = txt
          if (txt !== '' && /fail/i.test(txt) && S.failures.indexOf(txt) < 0) {
            S.failures.push(txt)
            statusPush(Date.now(), 'shell', '⚠ ' + txt)
          }
        }
      } else if (S.shellSeen && !S.shellGone) {
        S.shellGone = true
        statusPush(Date.now(), 'shell', 'shell 启动页已收起（应用已挂载）')
      }
    } catch (e) { /* 忽略 */ }
    try {
      var rs = globalThis.performance && globalThis.performance.getEntriesByType
        ? globalThis.performance.getEntriesByType('resource') : []
      for (var i = 0; i < rs.length; i += 1) {
        var r = rs[i]
        if (S.resSeen[r.name]) continue
        S.resSeen[r.name] = 1
        var size = r.encodedBodySize || r.transferSize || 0
        if (size < 60000) continue
        var short = String(r.name).replace(/^.*\/plugins\//, 'plugins/').replace(/^.*\/assets\//, 'assets/')
        if (short.length > 46) short = short.slice(0, 44) + '…'
        statusPush(S.t0 + Math.round(r.responseEnd || r.startTime || 0), 'net',
          short + '  ' + (size / 1048576).toFixed(2) + ' MB / ' + Math.round(r.duration) + 'ms')
      }
    } catch (e) { /* 忽略 */ }
    // 逐行露面：每行至少隔 LINE_GAP 毫秒；攒在队列里一起蹦出来会看不清顺序。
    if (LINE_GAP === 0) {
      S.revealed = S.lines.length          // 不节流：来多少显示多少
    } else if (S.revealed < S.lines.length) {
      var nowMs = Date.now()
      // 第一行立刻露面；之后每行至少隔 LINE_GAP
      if (S.lastRevealAt === 0 || nowMs - S.lastRevealAt >= LINE_GAP) {
        S.revealed += 1
        S.lastRevealAt = nowMs
      }
    }
    // 回放追平 ⇒ 重新评估能否进入（进入闸门可能一直压着没放行）
    if (S.revealed >= S.lines.length && S.revealed > 0 && !state.entered && !state.leaving) maybeEnter()
    renderStatus()
  }

  function renderStatus() {
    if (!S || !nodes.statusLog) return
    var body = ''
    var shown = Math.min(S.revealed, S.lines.length)
    for (var i = 0; i < shown; i += 1) {
      var L = S.lines[i]
      var rel = (L.abs - S.t0) / 1000
      body += (rel >= 0 ? '+' : '') + rel.toFixed(2) + 's  ' + L.src + '  ' + L.text + '\n'
    }
    if (S.lastBody !== body) { nodes.statusLog.textContent = body; S.lastBody = body }
    var used = ((Date.now() - S.t0) / 1000).toFixed(1)
    var pct = S.arc === null ? '不确定（shell 未提供）' : Math.round(S.arc * 100) + '%'
    var head = '启动状态 · 已用 ' + used + 's · 激活进度 ' + pct +
      ' · 启动图 ' + (S.bootSeen ? S.bootTotal + ' 条' : '等待中') +
      (LINE_GAP > 0 ? ' · 逐行回放（行首时刻为实测）' : '')
    if (S.lastHead !== head) { nodes.statusHead.textContent = head; S.lastHead = head }
    var tail = state.ready ? '✓ 外壳已就绪，正在进入…' : '… 等待外壳就绪'
    var cls = state.ready ? 'ok' : ''
    if (S.failures.length > 0) { tail = '⚠ 启动有失败项（点一下可进入）：' + S.failures[0].slice(0, 220); cls = 'bad' }
    if (S.lastTail !== tail) {
      nodes.statusTail.textContent = tail
      nodes.statusTail.className = 'boot-splash-status-tail ' + cls
      S.lastTail = tail
    }
  }

  /* -------------------------------------------------------------- 对外接口 */

  globalThis.__BOOT_SPLASH__ = {
    clientReady: function () {
      state.ready = true
      statusPush(Date.now(), 'renderer', '外壳就绪（客户端插件报到）')
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
  // 诊断：默认关。开了也要保证"提前点掉/页面被换掉"时数据不丢。
  if (DIAG) {
    startDiag()
    try {
      globalThis.addEventListener('pagehide', function () { flushDiag('pagehide') })
      globalThis.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flushDiag('hidden')
      })
    } catch (e) { /* 忽略 */ }
  }
  // 状态窗独立于视频启动：它要覆盖整个启动过程，立刻开始采集（不受 delayMs 影响）。
  startStatus()

  // 起播入口：只按 delayMs 等（为什么不做「等可见 / 等 rAF / 等首帧」那几条，见上一段注释）。
  if (DELAY > 0) globalThis.setTimeout(function () { start() }, DELAY)
  else start()

  // 上界一：到点提示可点击（不自动进，避免盖住还在渲染的界面）
  globalThis.setTimeout(function () {
    if (!state.leaving && !state.ready) setHint('启动较慢，点一下可以立即进入')
  }, HOLD)
  // 上界二：绝对上限 —— 无论发生什么，到点强制放行（绝不把人卡在启动页）
  globalThis.setTimeout(function () {
    if (!state.leaving) { note('到达绝对上限，强制进入'); enter() }
  }, ABSOLUTE_CAP)
}())
