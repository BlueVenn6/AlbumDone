# 自定义模型接口验收记录

本轮范围是用户明确批准的自定义接口补全。保留自动查重、手动筛选、照片 AI、年度回看以及 local-file 图片协议；不扩展到清理或更换框架。

## 问题及根因

旧的自定义接口只提供 direct/proxy 模式；实际请求由提供商和模型名推断。用户输入中转服务的模型别名后，协议可能与服务要求不同，图片能力也可能因为别名未命中正则表达式而被拒绝。Windows 表单还没有在字段变更时清除此前测试成功提示，自定义模型值在重新展开表单后可能显示为空。

## 改动

- 自定义接口明确选择 OpenAI Responses、OpenAI Chat Completions、Claude Messages、Gemini generateContent 四种已实现的协议。测试与实际照片请求共用同一个共享客户端；明确选择后不静默切换协议。
- 客户填写准确 API 地址、模型 ID 和自己的 API Key。自定义模型 ID 保留原值，仅去除两端空白；预设提供商现有迁移逻辑保留。
- 自定义接口分别测试文字和图片。图片测试发送应用生成的 64×64 红色色块 PNG，要求返回颜色名；普通文字回复 ok 不算图片测试成功。这只是基本图片输入验收，不证明全部照片任务的模型效果。
- 图片能力依据该配置的测试结果启用。测试记录绑定地址、模型、模式和协议；编辑 API Key 时表单清除测试记录。图片测试失败时停用该配置的图片能力；保存后和重启恢复时校验记录是否仍匹配。
- 测试期间禁用配置编辑、保存和删除；迟到结果不能覆盖已失效表单。协议、测试结果进入配置持久化，密钥继续使用原有安全存储，配置 JSON 不包含密钥。
- 新 Key 测试失败时不覆盖已保存 Key，也不把未通过的新地址或模型保存为实际运行配置。同一已保存配置的失败测试会清除相关验证状态。
- Android 与 iOS 共享组件只在修改前确认相同的组件上同步；各端原有客户端差异与原生工程保留。Windows 的 renderer、preload、main IPC 均传递相同协议与测试记录。

## 验证范围

修改前 customEndpoint 回归用例失败：显式选择 responses 仍进入 openai_compatible_negotiation。修改后同一路径通过。该用例检查四种请求路径、认证字段、真实色块图数据、文字与图片独立结果、任意模型别名、实际图片请求协议、失败后停用、配置变化失效、配置持久化与密钥分离。

Windows 页面验收脚本为 packages/desktop/scripts/cdp-custom-endpoint.cjs。使用实际 production renderer、preload、main IPC 和共享客户端，连接本机 HTTP 测试服务；测试凭据隔离在内存中，不读取或覆盖客户系统凭据。它不代表真实供应商账号或最终安装包验收。

## 最终验证结果

使用本机 Node 22 和 npm 10，构建/测试读取三个独立工作树的真实源码。测试期间固定输入摘要记录在 private/audit-20261012/custom-endpoint-build-inputs.json；源码测试及生产页面复测后核对应用、测试、原生配置与构建输入均未变化。

| 检查 | 结果及范围 |
| --- | --- |
| Android shared 全量行为回归 | 24 个测试脚本通过，包含四协议和配置恢复 |
| Windows shared 全量行为回归 | 23 个测试脚本通过 |
| iOS shared 全量行为回归 | 23 个测试脚本通过；保留旧连接入口行为，新增独立测试严格校验 |
| Android mobile 全量回归 | 19 个测试脚本通过，编译通过；包含四协议的 mobile HTTP transport 测试 |
| iOS mobile 全量回归 | 17 个测试脚本通过，编译及类型检查通过；包含四协议的 mobile HTTP transport 测试 |
| Windows desktop 回归 | 8 个测试脚本通过；其中 6 个 UI 验收脚本的断线必须判失败 |
| Windows production build | main + shared + renderer 构建通过，最后 renderer 为 index-DSI2oSPh.js |
| Windows 完整 renderer 类型检查 | 原 HEAD 20 个错误，当前 0 个；已增加 tsconfig.renderer.json，build:renderer 与 typecheck 强制检查 |
| Windows 实际自定义接口页面 | 16 次本机请求通过：四协议的文字/图片/运行时图片、重启恢复、模型/Key 改动失效、错误 Key 不覆盖原 Key、失败图片停用、测试期间锁定字段 |
| 1200 图 production 页面复查 | 首批 50 张 1235 ms，总计 1935.5 ms；手动筛选、查重、照片 AI 与回看入口可进入；年度拼图 6142 ms，1600×1240 输出经 local-file 正确解码并可见 |
| 手动筛选行为 | 撤销、删除决定保存、重载回到同一照片，以及快速第二次点击不会覆盖已接受决定通过 |
| 原照片 AI 页面 | 照片+提示词发送、结果显示、错误 200 不算成功、503 后重试及取消真实 HTTP 请求通过，共 6 次本机请求 |

生产页面证据在 private/audit-20261012/ui/custom-endpoint-final.json、custom-endpoint-core.json 与 custom-endpoint-culling.json。核心页面这轮 CDP 截图采集超时，记录为未获取截图；图片身份、像素、解码和可见区域断言通过。隐藏窗口下手动筛选测得 3213/942/843 ms，document.hidden=true，80 ms 定时器实际 371 ms；此数据不能当成前台流畅度验收，也不能推断手机流畅度。

最初移动端按钮条件出现 TypeScript 错误，已修正并重跑移动端全部测试。iOS 最初独立图片校验影响旧入口的已有用例，已限制新规则适用范围，原用例未删除或弱化，重跑全量通过。Windows 完整 renderer 检查曾暴露既有 20 项类型问题，采取类型声明与可空值校验的最小修正，生产核心路径复查；没有关闭 strict 或降低检查门槛。移动端 modelConfigParity 用例仅更新新增 testMode 参数对应的调用断言，原来的“测试配置与运行配置一致、使用同一传输与安全存储”约束保留。

本轮没有 package、assemble APK 或 IPA；没有最终安装包路径、大小、时间或 SHA-256。**当前 State B，尚未达到 State C/D 或售卖验收标准。** Android 无已连接设备，iOS 当前 Windows 环境没有 Xcode，无法进行两端本轮真机验收。没有供应商测试凭据，不能声称某个模型在客户账号下一定可用。OpenAI/Google 最新生命周期官方核对仍未取得有效证据；按用户此前要求，不据此提前打包。

实际命令：

```text
npm --workspace @photo-manager/shared run test
npm --workspace @photo-manager/mobile run test
npm --workspace @photo-manager/mobile run typecheck
npm --workspace @photo-manager/desktop run build
npm --workspace @photo-manager/desktop run build:renderer
Windows desktop tests（已有 build:main 输出）：依次执行 package.json test 中的 8 个测试脚本
cdp-custom-endpoint.cjs 9253
cdp-pre-release-smoke.cjs 9253 <合成照片目录> <证据目录> 1200
cdp-culling-performance.cjs 9253 <合成照片目录> --reset-test-checkpoint
cdp-culling-performance.cjs 9253 <合成照片目录> --reset-test-checkpoint --rapid-decisions
cdp-ai-workflow.cjs 9253 <合成照片目录>
```

原照片 AI 验收脚本首次失败为 Screenshot row missing：它先选中右侧处理区大图，而左侧懒加载行还没有 img。页面 DOM 与源码核对确认此原因后，仅修正脚本定位真实侧栏行的选择器，原照片输入、结果、重试与 HTTP 取消断言保留；复测通过，六个脚本断线回归也重跑通过。此次只修改验收脚本，不改变已测试的应用源码或构建输出。
