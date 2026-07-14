# iPhone Testing From Windows

## 为什么 Windows 不能本地跑 iOS

- iOS 模拟器依赖 Xcode，只能在 macOS 上运行。
- React Native iOS 原生工程需要 Xcode、CocoaPods、codesign 与 Apple 工具链，Windows 不能本地完成签名打包。
- 因此当前仓库在 Windows 上只能本地开发 JS/Android，iPhone 真机测试必须走云端或远程 macOS 构建。

## 当前项目的推荐路线

- 维持现有 React Native CLI 工程，不迁移 Expo。
- Windows 本地继续完成 JS 开发、TypeScript 检查、Android 真机联调。
- iPhone 真机测试使用私有 Git 仓库 + Codemagic 云端构建 + TestFlight 内测。

## Apple Developer 前置条件

- 拥有有效的 Apple Developer Program 账号。
- 在 App Store Connect 中创建应用记录，Bundle ID 使用 `com.linkvectorapp.albumdone`。
- 在 Apple Developer 后台为 `com.linkvectorapp.albumdone` 创建 App ID。
- 确认账号具备证书、Profiles、TestFlight 内测权限。

## iPhone 设备侧准备

- 在 iPhone 上登录用于测试的 Apple ID。
- 打开 `设置 > 隐私与安全性 > 开发者模式` 并启用 Developer Mode。
- 如果要用 Ad Hoc/Development 包安装，先在 Apple Developer 后台注册设备 UDID。
- 如果走 TestFlight 内测，只需把测试账号加入 TestFlight 内测组。

## 签名 / Provisioning 检查点

- Xcode target/scheme 允许继续使用 `HelloWorld` 内部名称。
- 真正生效的 Bundle ID 必须是 `com.linkvectorapp.albumdone`。
- 需要在 Codemagic 里配置 App Store Connect integration。
- 需要让 Codemagic 可访问对应 Team、证书和 Provisioning Profile，或启用自动签名。
- 首次构建前确认 `codemagic.yaml` 中 workflow 名称、workspace、scheme 与仓库结构一致。

## 推荐执行顺序

1. 在 Windows 本地完成代码修改并推送到私有 Git 仓库。
2. 在 Codemagic 连接仓库，启用 `codemagic.yaml` 配置。
3. 配置 `Photo Manager App Store Connect` integration。
4. 在 Apple Developer / App Store Connect 中确认：
   - App ID：`com.linkvectorapp.albumdone`
   - App Store Connect 应用记录已创建
   - 内测组 `Internal Testers` 已创建
5. 在 Codemagic 触发 `ios-testflight` workflow。
6. 构建完成后检查 IPA 上传和 TestFlight 处理状态。
7. 在 iPhone 上安装 TestFlight，并接受内测邀请后安装应用。

## 构建成功后如何安装到 iPhone

- 在 App Store 安装 `TestFlight`。
- 用被加入内测组的 Apple ID 登录。
- 打开邀请链接或在 TestFlight 中看到 `照片管家`。
- 安装并首次启动应用。
- 首次启动前确认 iPhone 已开启 Developer Mode，避免调试/开发包安装失败。

## 常见阻塞点与排查顺序

1. 先看 Bundle ID 是否与 Apple 后台完全一致：`com.linkvectorapp.albumdone`
2. 再看 Codemagic integration 名称和凭据是否有效
3. 再看签名材料是否覆盖 `HelloWorld` target 的 app profile
4. 再看 `pod install` 是否成功，`HelloWorld.xcworkspace` 是否可用
5. 最后看 App Store Connect/TestFlight 的处理状态、测试账号是否在内测组

## Windows 本地能做的事

- 执行 `npm install`
- 执行 `npm run typecheck --workspace=@photo-manager/shared`
- 执行 `npm run typecheck --workspace=@photo-manager/mobile`
- 执行 `npm run build --workspace=@photo-manager/shared`
- 执行 `npm run build --workspace=@photo-manager/mobile`
- 执行 Android 真机本地测试，提前发现 JS、权限、相册、OCR、AI 链路问题
