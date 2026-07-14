# Blockers Before First iOS Device Test

## 阻塞 1：App Store Connect / Apple Developer 未完成应用登记

- 风险点：`com.linkvectorapp.albumdone` 尚未在 Apple 后台完整创建
- 触发条件：Codemagic 首次发起签名或上传 TestFlight
- 表现：签名失败、找不到 App ID、上传被拒绝
- 临时规避办法：先在 Apple Developer 创建 App ID，再在 App Store Connect 创建对应应用
- 正式修复方向：把 Apple 后台准备项写入固定发布 SOP

## 阻塞 2：Codemagic integration 或签名材料未配置完整

- 风险点：Codemagic 只有仓库权限，没有可用的 App Store Connect / signing 配置
- 触发条件：运行 `ios-testflight` workflow
- 表现：`xcode-project use-profiles` 失败，或 IPA 上传失败
- 临时规避办法：先补 App Store Connect integration、证书、Provisioning Profile、Team 访问权限
- 正式修复方向：沉淀一套可复用的 Codemagic 环境变量与签名模板

## 阻塞 3：`pod install` 或原生依赖在云端未同步成功

- 风险点：iOS Pods 没有正确安装，或 monorepo 路径解析失败
- 触发条件：Codemagic 执行 Pod 安装或编译阶段
- 表现：找不到 React Native 依赖、workspace 不完整、编译报错
- 临时规避办法：优先检查 `packages/mobile/ios/Podfile`、`HelloWorld.xcworkspace`、`npm install` 是否成功
- 正式修复方向：增加云端构建前的依赖与 workspace 校验脚本

## 阻塞 4：照片权限文案或权限行为与真实功能不一致

- 风险点：Info.plist 文案缺失或后续功能超出当前权限说明
- 触发条件：iPhone 首次访问照片或保存处理结果
- 表现：系统权限弹窗异常、审核风险、用户不敢授权
- 临时规避办法：首测只覆盖读取相册和保存结果两条已声明链路
- 正式修复方向：随着功能扩展持续维护权限说明和隐私文档

## 阻塞 5：`ph://` 图片读取在真机上仍存在兼容性风险

- 风险点：当前读取方案已改为原生文件读取优先，但 iOS 真机仍需实测
- 触发条件：从 iPhone 照片库选择截图或照片进入 OCR/AI 流程
- 表现：读取失败、base64 转换失败、OCR 前中断
- 临时规避办法：首测优先验证一张常规照片和一张截图，并保留失败 URI 与日志
- 正式修复方向：补更稳定的 iOS asset 解析桥接和自动化回归样例
