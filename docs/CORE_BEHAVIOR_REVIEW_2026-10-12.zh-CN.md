# 核心行为与改动复核

这是一份交付前复核记录，不是上架放行证明。没有本轮 APK、Windows 安装包或 IPA 的真实验收结果；源码和生产页面检查不能代替最终安装包验收。

## 源码范围

- Android：`C:\Users\esthe\photo-manager`，修改前 `f3c04330c3293f58a73662e6e30246a99e2f57ff`，功能修补提交 `0c7105d70f30d8e669c5e9f6ef5ce800a0ff7541`。
- Windows：`C:\Users\esthe\AlbumDone-release\desktop`，修改前 `fa79ad15e00c401f546344707aa061264bc12925`，功能修补提交 `bd1c2a785a5fbb1a50840ae42a4832a94ff5f172`。
- iOS：`C:\Users\esthe\AlbumDone-release\ios`，平板适配前 `48134ffb7d3108966fccba05d090028b18fb437b`。RN 0.74.7 原生工程与 Android 的 RN 0.81.6 分别保留。
- 平板适配、Windows 拼图预览、快速决策保护及模型配置修补是上述提交之后的新增差异。下文记录对应的源码和 production 页面检查；冻结提交与安装包验证仍单独计算。

本轮通过检查的功能源码提交：

| 平台 | 功能源码提交（文档归档前） | 模型/缓存提交 |
| --- | --- | --- |
| Android | `4ee71c463ce6b603c10ddd5eda5601e22df29216` | `91caec1` |
| Windows | `8d6d4f57c1c91a9a2ebbdc988814e7aaeb19f399` | `5b743ac` |
| iOS | `46a3006ee2344fee6c984cfb7366e56e8e4db059` | `de362ec` |

## 四个核心功能

| 功能 | 本轮实际调整 | 对照检查保留的行为 | 验证边界 |
| --- | --- | --- | --- |
| 自动查重 | Android 元数据分页、按需读取缺失尺寸；Android/Windows 大重复组虚拟化；删除核对与计数 | 查重算法、照片范围选择、分组、手工调整保留/删除、取消及任务恢复入口 | 共享查重与任务行为测试此前通过；Windows 实际 UI 大组首屏/末屏仅挂载 20 张卡片，缩略图真实解码、末屏选择和返回首屏后的选择状态均通过；取消流程通过；Android 仍需确切 APK 真机验证 |
| 手动筛选 | 统一真实删除结果；Windows 增加单独确认的永久删除；平板下卡片宽度与可滚动设置页 | 保留/删除决策、撤销、前后切图、批次、继续及重新开始 | cullingStore/任务与真实文件删除此前通过；Windows 实际 UI 切图、撤销、删除标记、刷新恢复已通过，新增连续点击根因与复测见下文；不能把回收站当作释放原图空间 |
| AI 照片交互 | Windows 采用共享连接判定；端口/地址校验；官方有证据的 DeepSeek Flash 名称迁移；平板预览与输入区布局 | 图片选择、提示词、结果展示、原生传输与 IPC、用户保存的可用配置 | Android/Windows 37 个共享模型的协议矩阵通过；实际 production UI→preload→主进程 IPC→本机 HTTP 服务的图片/提示词、错误恢复与取消已通过。这不是厂商实网调用或识图准确率证明 |
| 年度回看 | Android 等待图片加载再导出、释放临时截图；Windows 增加页面内生成 JPG 的图片一览；平板阅读宽度 | 时间范围、选片规则、拼图布局、输出文件、打开文件、移动端保存相册 | 原验收只检查导出文件像素，漏了页面预览，原结论不足。实际 production 页面确认预览读取本次 JPG、完成解码并可见；12 格拼图截图已查看。尚未由最终安装包或手机证明 |

## 回看图片一览缺失的证据

用户截图显示 Windows 回看页只有路径和文字，必须按实际缺陷处理。修改前 Windows 页面 `YearInReviewScreen.tsx`、两份保留的 desktop 源码归档及主仓库可读取的历史版本均未渲染生成的拼图。本轮 Windows 功能提交未修改该页面；移动端页面存在 `<Image>` 拼图。现存证据不能解释用户更早实际使用的其他版本，不能据此否认其观察。

新增 Windows 预览复用现有 `pathToLocalFileUri` 和 `protocol.handle('local-file')`，读取已有授权输出目录；不新增协议、不放宽文件访问权限。预览在选片说明之前显示，有加载失败和重试状态。“打开文件”保留在预览旁。

## 验收脚本缺口

一次真实页面检查在连接断开后没有完整结果，却返回退出码 0。这个结果已排除，不能称为通过。`cdp-pre-release-smoke.cjs` 现对断线、命令超时和未完成检查明确失败；增加的断线回归测试确认退出码 1 且无成功结果。

预览验收新增检查：生成文件与页面图片的确切路径一致；图片真实解码尺寸一致；显示区域大于 100×100 且可进入视口；使用 `local-file:///`；保留页面截图。完整检查没有产出结果时，一律不放行。

后续记录确认测试窗口最小化；恢复该确切窗口后，调试响应立即恢复。独立预览检查确认页面加载了本次输出 `year-in-review-1791776392722.jpg`，真实解码尺寸 1600×1240，显示区域约 786×536，完整处于视口内；截图 `C:\Users\esthe\AppData\Local\Temp\albumdone-ui-preview-20261012\evidence\07-year-review-visible.png` 已实际查看，12 格拼图可见。验收照片为合成测试图库。此为 production 页面验证，不是安装包验收；此前超时的全流程检查不能记为通过。后续全流程独立重测完成：1,200 张合成图片首批 50 张返回 2,056 ms、导入总计 3,582 ms；四个核心入口、页面刷新后的计数和回看导出通过。回看约 12,935 ms，生成 `year-in-review-1791778258592.jpg`，预览解码 1600×1240，页面显示约 786×536 并处于视口内。证据截图原路径为 `C:\Users\esthe\AppData\Local\Temp\albumdone-ui-core-20261012\evidence`，已另归档于主仓库 `private/audit-20261012/ui`。这些数字来自本机合成图库与当前负载，不等于安卓性能承诺。用户已明确确认曾手动关闭窗口，正常退出不能记为应用崩溃。

## 平板改动边界

Android/iOS 均采用实时窗口尺寸和安全区计算；图库随宽度增加列数，手机仍为 3 列；横屏宽窗口的 AI 图片与输入区并排；筛选卡片随窗口变化；设置/回看阅读区居中并限制过宽。Android 显式允许可调整窗口；iOS App 目标设备为 iPhone+iPad，iPad 支持四个方向。

旧测试把所有设备固定 3 列写成了源码断言，与用户新增的平板要求冲突。该断言改为检查图库使用响应式列数，另由几何约束测试继续验证手机 3 列、平板增加列数、旋转/分屏/安全区不溢出。没有删除手机约束，也没有以类型检查代替 iPad 真机验收。Windows 环境无法执行 Xcode 原生编译。

## 删除和清理

功能代码删除为未接入的共享 `multimodalClient.ts` 包装层、Windows 回看中未调用的私有选片函数及未使用私有参数；没有删除页面入口或原生平台工程。小范围清理必须继续受相关行为测试保护。

用户本机清理记录确认 13 个旧产物/历史副本已删除，合计 4,752,263,132 字节，约 4.43 GiB。详情见 `CLEANUP_2026-10-11.zh-CN.md` 和 `private/cleanup-20261011/cleanup-20261012T005834250Z.json`。当前 Windows Git 数据库 `private/release-audit-20260920/desktop-live/.git`、当前三端工作树、用户照片和私有设置保留。

## 模型核对范围

本轮读取了 DeepSeek、阿里云、智谱、MiniMax 和 Anthropic 官方资料。Anthropic 普通网页此前跳转区域页，后从官方 `llms-full.txt` 取得包含型号与退役表的文档，不能继续沿用“未核实”的旧结论。官方依据：

- [Anthropic 型号及能力](https://platform.claude.com/docs/en/models/overview)、[退役表](https://platform.claude.com/docs/en/about-claude/model-deprecations)：新增 Sonnet/Opus/Haiku 5.5 可选项；仅迁移退役表明确列为 retired 的旧 Claude 型号，保留仍有效的 Sonnet 5 等已保存选择。
- [Anthropic 参数约束](https://platform.claude.com/docs/en/build-with-claude/thinking)：4.7 及后续代际不再接受自定义采样参数。本工具此前仍发送 temperature，新增回归测试先复现失败，再对这些型号省略该字段；4.6 的既有参数行为保留。
- [阿里云视觉接口](https://help.aliyun.com/zh/model-studio/vision)：已确认 Qwen 3.8 Max 的图片输入，新增该选项；未将仅有文本证据的型号冒充视觉型号。
- [DeepSeek 型号](https://api-docs.deepseek.com/quick_start/pricing)、[更新](https://api-docs.deepseek.com/updates)：Flash 使用官方当前别名，Pro 保留文本能力边界。

OpenAI 官方页面与文本索引仍返回 403，Google 模型/退役页、文本索引、Firebase 型号页仍超时；官方 GitHub 替代读取也被远端断开。这两家的最新生命周期核对未完成，现有型号不能因此宣称均未过期，也没有凭猜测替换。检索工具本身返回 HTTP 500，失败保留在记录中。厂商实际账号权限和识图正确性未通过本轮外部 AI 调用证明。
移动端当前显示 OpenAI、Anthropic、Qwen、MiniMax 和自定义接口；Windows 的共享模型配置另含其他厂商。这个范围差异存在于修改前版本，本轮没有擅自增加或删除移动端厂商入口。Kimi 名称仍为 `kimi-k2.5`，temperature=1；不根据导航标题或文档重定向就强行迁移用户已有配置。

## 后续发现的两项真实根因

Windows 手动筛选有约 80 ms 的反馈延迟；同一张照片连续点击“保留”与“删除”会排入两次决定，后一次覆盖第一次。修改前相同 UI 测试实际失败。现只接受一个待提交决定，并在撤销/卸载时清掉该计时器。相同连续点击复测保留第一条决定；相邻的正常切图、撤销、删除标记和 renderer 刷新恢复也通过。最新切图最大实测 412 ms，受本机负载影响。

同版本模型缓存不会经过 persist.migrate，而原 onRehydrateStorage 回调在同步初始化结束前引用 useSettingsStore 自身，迁移静默失效。新增同版本持久化测试实际失败；用户单独批准后，把现有规范化迁到 persist.merge，未换存储或图片协议。Android/Windows 的同步与 AsyncStorage 异步方式均通过，保留自定义接口地址、提示词、默认路由和有效型号，普通配置不保存运行时密钥。Windows 实际设置页确认退役旧型号迁为 Sonnet 5.5、有效 Sonnet 5 保持不变。iOS 独立工作树的共享行为、同版本同步/异步持久化和移动端类型检查也已通过。

一次筛选脚本传入了不存在的合成图库路径，实际返回 ENOENT，未计为通过；从运行页面 history.state 确认真正合成图库路径后，连续点击与正常筛选分别通过。

异步测试最初用了不符合原有视觉型号识别规则的自定义测试名称，既有规则会把它视为文本模型。测试图片路由改用已有受支持的 gpt-4o 自定义接口型号，继续检查默认视觉路由、完整配置和密钥隔离；没有削弱断言或更改产品视觉判断规则。

验收脚本对断开连接不能返回成功，导入/回看、手动筛选、查重、AI、设置迁移五个脚本的真实断线回归均确认退出码 1 且不输出成功结果。

## 放行条件

各项源码回归、生产 UI 及平板检查完成后，才能冻结提交并生成唯一可追溯验收包。APK 真机 1000–2000 图导入、删除 200 张后的原图/缓存/存储核对、AI 已知图片、回看预览与保存，以及确切 Windows 安装包原始场景都未完成前，不得宣称 State D 或达到上架售卖标准。

## 最新验证状态和构建输入

Android 最新共享层 22 项行为测试通过，另补跑异步持久化测试、模型配置和平板几何约束；移动端 TypeScript 通过。此前移动端 19 项回归及 Android Validation Kotlin 原生编译通过，新平板/模型调整没有修改 Kotlin。iOS 最新共享层 22 项行为测试与移动端 TypeScript 通过；此前移动端回归通过。Windows 最新 production build 通过，同版本同步/异步缓存、型号参数、有效配置保留、路由回归通过；此前全套共享层和桌面行为测试通过，新增五个验收脚本断线检查及筛选/AI/设置实际页面复测通过。

源码快照保存在 `C:\Users\esthe\AppData\Local\Temp\albumdone-source-freeze-20261012`；证据另归档于 `private/audit-20261012`，当前三端工作树和 Git 数据库保留。三个独立 Git 工作树分别冻结，source src 摘要与包含原生配置/入口/lockfile 的 build-input 摘要分开记录。正式打包前还必须重新核对最终提交和干净状态。Windows Vite 读取 shared/src，而主进程读取 shared/dist；不能只重建 renderer 就宣称主进程更新。本轮隔离测试窗口只用于 production 页面检查，不能冒充最终安装器；检查结束后通过正常窗口关闭流程退出。

本轮未生成 APK、EXE 安装器或 IPA，因此没有最终 artifact 路径、大小、时间或 SHA-256 可报告。当前等级是 **State B**，不是 State C / D。

用户要求模型等细节核查完整后才能打包；OpenAI/Google 官方生命周期仍无法核实，所以本轮不提前打包。后续取得官方资料并完成核对后，才可从同一冻结源码生成唯一 Windows/Android 验收包；安卓用户安装该确切 APK，iOS 原生/平板仍需 Mac/Xcode 条件。正式上传签名和商店真实公开联系方式/隐私支持页面同样未齐备，不能把验收包称为已经达到售卖标准。

使用 Node 22 + 本机 npm 10，实际验证命令包括：

```text
Android: npm --workspace @photo-manager/shared test
Android: npm --workspace @photo-manager/mobile run typecheck
Android: node packages/shared/tests/settingsHydration.test.cjs
Android: node packages/mobile/tests/modelConfigParity.test.cjs
Android: node packages/mobile/tests/responsiveLayout.test.cjs
Windows: npm --workspace @photo-manager/desktop run build
Windows: node packages/shared/tests/anthropicCompatibility.test.cjs
Windows: node packages/shared/tests/settingsMigration.test.cjs
Windows: node packages/shared/tests/settingsHydration.test.cjs
Windows: node packages/shared/tests/providerRoute.test.cjs
Windows: node packages/desktop/tests/uiAcceptanceHarness.test.cjs
Windows: cdp-culling-performance.cjs --rapid-decisions / 普通路径
Windows: cdp-ai-workflow.cjs / cdp-settings-migration.cjs
另有此前完整桌面测试、dedup 大组/取消与 pre-release 全流程的通过记录。
iOS: npm --workspace @photo-manager/shared test
iOS: npm --workspace @photo-manager/mobile run typecheck
```

Windows build 输入为真实 desktop/src 和 shared/src，输出 desktop/dist 与 shared/dist；Vite 最新输出 `index-BxTlMGAx.js`。没有执行本轮 package 或 assemble APK；最终安装器/手机验收没有结果，不能用 production 页面证据替代。
