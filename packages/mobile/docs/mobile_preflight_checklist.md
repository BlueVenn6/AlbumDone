# Mobile Preflight Checklist

## 依赖安装

- [ ] 在仓库根目录执行 `npm install`
- [ ] 成功判定：根目录 `node_modules` 安装完成且无中断错误
- [ ] 失败时记录内容：完整命令输出、Node 版本、npm 版本

## Android 原生同步

- [ ] 执行 `npm run ensure:native:android --workspace=@photo-manager/mobile`
- [ ] 成功判定：命令正常退出，`packages/mobile/android` 未提示缺失工程文件
- [ ] 失败时记录内容：命令输出、缺失文件路径、当前分支/提交

## iOS 原生同步

- [ ] 执行 `npm run ensure:native:ios --workspace=@photo-manager/mobile`
- [ ] 成功判定：命令正常退出，`packages/mobile/ios` 未提示缺失工程文件
- [ ] 失败时记录内容：命令输出、缺失文件路径、当前分支/提交

## Metro 缓存清理

- [ ] 执行 `npx react-native start --reset-cache --projectRoot packages/mobile`
- [ ] 成功判定：Metro 正常启动且无重复解析/monorepo 路径报错
- [ ] 失败时记录内容：Metro 首屏日志、报错堆栈、是否存在端口占用

## Android Clean / Gradle Sync

- [ ] 进入 `packages/mobile/android`
- [ ] 执行 `.\gradlew clean`
- [ ] 在 Android Studio 中执行 Gradle Sync（如使用 IDE）
- [ ] 成功判定：`clean` 成功且 Sync 无依赖解析错误
- [ ] 失败时记录内容：Gradle 版本、Android SDK 版本、完整报错

## iOS Pod Install / DerivedData 清理

- [ ] 在 macOS 或云端构建环境进入 `packages/mobile/ios`
- [ ] 执行 `pod install --repo-update`
- [ ] 如出现旧缓存，清理 DerivedData：`rm -rf ~/Library/Developer/Xcode/DerivedData/*`
- [ ] 成功判定：生成或更新 `HelloWorld.xcworkspace`，Pod 安装无失败
- [ ] 失败时记录内容：Pod 版本、Ruby 版本、完整报错

## Android 本地启动顺序

- [ ] 先启动 Metro：`npm run dev --workspace=@photo-manager/mobile`
- [ ] 再连接 Android 真机并开启 USB 调试
- [ ] 执行 `npm run android --workspace=@photo-manager/mobile`
- [ ] 成功判定：App 安装成功并进入首页，无红屏
- [ ] 失败时记录内容：`adb devices` 输出、安装报错、RN 红屏内容

## iOS 云端构建启动顺序

- [ ] 确认代码已推送到私有 Git 仓库
- [ ] 在 Codemagic 连接仓库并选择 `codemagic.yaml`
- [ ] 配置 App Store Connect integration、签名材料、Bundle ID
- [ ] 触发 `ios-testflight` workflow
- [ ] 成功判定：生成 IPA 并成功上传 TestFlight
- [ ] 失败时记录内容：Codemagic 构建日志、签名报错、App Store Connect 返回信息

## 首测前静态检查

- [ ] 执行 `npm run typecheck --workspace=@photo-manager/shared`
- [ ] 执行 `npm run typecheck --workspace=@photo-manager/mobile`
- [ ] 视情况执行 `npm run build --workspace=@photo-manager/shared`
- [ ] 视情况执行 `npm run build --workspace=@photo-manager/mobile`
- [ ] 成功判定：命令全部通过，无新增类型错误
- [ ] 失败时记录内容：失败命令、报错文件、报错行号
