[English](README.md) | [简体中文](README.zh-CN.md)

# 正好相册 AlbumDone

离线 Windows 照片整理工具。本分支准备 **0.2.0 无 AI 桌面版本**，保留公开仓库的历史，尚未发布新的 GitHub Release。

## 三个主要功能

- **自动去重**：选择检查数量，逐组预览，默认保留一张，可更换保留照片或整组保留；确认后才执行删除。大图只是组内某张照片的预览。检查完成后可返回数量选择，并保留文件夹进度。
- **手动筛选**：单张或网格查看，标记保留/删除、撤销及键盘操作；完成后可选择下一批。
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

参见 [操作说明](docs/USER_GUIDE.md)、[隐私说明](PRIVACY.md)、[构建来源](RELEASE_SOURCES.md)。手机端在独立私有仓库维护。禁止将手机签名材料放入本公开仓库。许可证：[MIT](LICENSE)。
