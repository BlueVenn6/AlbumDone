[English](README.md) | [简体中文](README.zh-CN.md)

# 正好相册 AlbumDone

离线 Windows 照片整理工具，当前桌面版本为 **0.2.1 无 AI 版**，使用 MIT 许可证，保留公开仓库历史。

## 0.2.1 当前状态

[发布记录](CHANGELOG.md)列出已经验收的变更、确切的运行源码提交和安装包校验值。本次更新公开桌面源码和说明文档，尚未在 GitHub Release 上传 0.2.1 安装包；历史 Release 下载仍对应各自标注的旧版本。

现有 0.2.1 安装包**尚未签名**。安装包内程序已通过记录中的功能检查，包括 15 种语言排版和 JPG 导出；覆盖安装、升级尚未验收。SignPath 签名是后续独立的发布步骤，详见[代码签名政策](CODE_SIGNING_POLICY.md)。

## 三个主要功能

- **自动去重**：选择检查数量，逐组预览，默认保留一张，可更换保留照片或整组保留；确认后才执行删除。大图只是组内某张照片的预览。检查完成后可返回数量选择，并保留文件夹进度。
- **手动筛选**：单张或网格查看，支持上一张/下一张按钮、标记保留/删除、撤销及键盘操作；浏览照片不会自动标记为已审阅，完成后可选择下一批。
- **年度回顾**：过去十二个月或上一自然年，每月一张，可更换同月候选照片和空月份寄语，保存当前实际选择的 JPG。

内置 15 种语言，可切换。保留文件夹、缩略图、本地任务恢复和回收站功能。本版移除模型设置、模型请求、密钥管理、截图指令和 OCR；照片筛选需要的本地截图文件名识别仍保留。

## 开发、验收与打包

要求 Windows x64、Node 22.23.4、npm 12.2.2 和 Git。完整命令见 [英文说明](README.md)。

```powershell
npm ci
npm run lint
npm run typecheck
npm run test
npm --workspace @photo-manager/desktop run build
npm --workspace @photo-manager/desktop run test:e2e
```

生产界面验收使用人工生成的照片和独立的应用数据目录，不读取真实相册。提交已经测试的源码后，运行：

```powershell
npm --workspace @photo-manager/desktop run package
```

输出位于 `packages/desktop/release`，包含嵌入源码身份的应用、安装器和 SHA-256 构建记录。源码测试、构建、打包与实际安装包验收分别记录，不互相替代。

参见 [0.2.1 发布记录](CHANGELOG.md)、[操作说明](docs/USER_GUIDE.md)、[隐私说明](PRIVACY.md)、[构建来源](RELEASE_SOURCES.md)、[代码签名政策](CODE_SIGNING_POLICY.md)。手机端在独立私有仓库维护。禁止将手机签名材料放入本公开仓库。许可证：[MIT](LICENSE)。
