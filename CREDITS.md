# 致谢 / Credits

## 本项目的代码

`boot-splash` 的代码由 **GA17-LHY** 编写，MIT 许可（见 `LICENSE`）。

## 借鉴了公开的接口事实（**未复制任何代码**）

**[`lxj5820/dsh-boot-animation`](https://github.com/lxj5820/dsh-boot-animation)**（MIT）

我们读过它的源码，从中确认了三条 **DeepSeek Harness 的公开接口事实**——这些是接口/机制本身的性质，不受版权保护；本项目的实现是独立编写的：

1. **`webserver/index-inject` 是唯一足够早的注入时机** —— 推进去的行会渲染进 `<head>`，早于外壳模块；更晚的任何手段都盖不住内核启动页。
2. **路由必须用 `exact`，只有素材路径用 `prefix`** —— 若在 `/plugins/<包名>` 上挂前缀路由，会把 `/plugins/<包名>/client.js` 一起吃掉，而那条 URL 是 client-modules 用来物化本包客户端 bundle 的 ⇒ 客户端半侧永远加载不了。
3. **官方槽位分工** —— `plugins.item` 是**官方插件**的配置卡槽；第三方组合包的配置应挂 **`plugins.bundle.config`**（以组合包包名为键）；`plugins.row.config` 以 `bundle#rowId` 为键；`settings.section` 是设置整页。

> ### 素材（已随包分发）
> 那个项目自带的 3 段 mp4 已**原样复制**进 `assets/videos/`（逐字节校验一致），并按 MIT 的要求**随附完整许可与版权声明**：见 `assets/videos/LICENSE-dsh-boot-animation.txt`（原始版权行 `Copyright (c) 2026 dsh-boot-animation contributors`）。
>
> **⚠️ 关于"作者原创"的说法：有反证据。** 我们把这三段片的元数据读了一遍：
> - `1.mp4` / `2.mp4` 内嵌 **C2PA 内容凭证**，写着 `softwareAgent = Volcengine_Ark_CN 1.0.0`、`model_name = doubao-seedance-2-5`（另一段是 `-2-0`）、`digitalSourceType = trainedAlgorithmicMedia`、生成时间 `2026-09-26`；
> - `3.mp4` 只有 x264 编码器标签。
>
> 也就是说**这两段是 AI 生成的视频**（豆包 Seedance / 火山方舟），而不是上游所描述的"作者自己的动画作品"。我们照它给的 MIT 许可原样再分发、保留声明，并在署名文件里**如实记录这个出入**，而不是跟着复述那个说法。
> 另：AI 生成物可能同时受生成服务条款约束（此处为 Volcengine Ark / Doubao），**我们没有审查那些条款**——要商用请自行核对，或直接换成自己的素材。

## 运行环境

**DeepSeek Harness（DSH）** —— 本插件是它的插件，运行于其插件系统与客户端模块系统之上；本项目**未内联 DSH 的任何代码**。

## 关系声明

本项目与上述项目之间**没有从属、赞助或背书关系**；`boot-splash` 是本项目自己的名字。
