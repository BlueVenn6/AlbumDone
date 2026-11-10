[English](README.md) | [简体中文](README.zh-CN.md)

# 正好相册 AlbumDone

在自己的电脑上整理照片。正好相册是 **Link Vector Pty Ltd** 开发的免费开源 Windows 照片整理工具，提供自动去重、手动筛选和年度回顾。照片在本地处理，无需注册账号，也无需上传照片库。

## 产品截图

![正好相册中文首页，展示自动去重、手动筛选和年度回顾](docs/assets/screenshots/albumdone-library-zh-CN.png)

Windows 桌面界面，使用演示图库展示。另见[英文界面](README.md#product-preview)。

## 主要功能

- **自动去重**：逐组比较相似照片，选择保留哪张，也可整组保留。通过大图预览看清照片后再决定。
- **手动筛选**：使用上一张、下一张按钮或键盘浏览，标记保留或删除，支持撤销审阅选择，并可分批继续整理。
- **年度回顾**：选择过去十二个月或上一自然年，每月挑选一张照片，将当前选择保存为 JPG。

内置 15 种界面语言，提供缩略图、本地审阅进度恢复和 Windows 回收站选项。当前桌面版采用本地照片处理，不包含 AI 功能。

## 版本与下载

当前源码版本为 **0.2.2**，面向 **Windows x64**。0.2.2 安装包尚未发布到 GitHub Releases。现有的 [v0.1.2-beta.10 下载](https://github.com/BlueVenn6/AlbumDone/releases/tag/v0.1.2-beta.10)是旧测试版，不包含当前版本的更新。

[发布记录](CHANGELOG.md)中的 0.2.2 安装包尚未签名；包内程序已进行运行检查，系统安装和升级尚未验证。文件校验值及具体检查范围见发布记录，签名进展见[代码签名政策](CODE_SIGNING_POLICY.md)。

## 开始使用

1. 选择本地照片文件夹。
2. 进入自动去重、手动筛选或年度回顾。
3. 检查选择后确认删除，或保存年度回顾图片。

标记待删除不会立即删除照片。相似度建议需要您自行核对；重要照片请保留备份，永久删除无法在本应用内撤销。批次规则、具体操作和文件处理说明见[操作指南](docs/USER_GUIDE.md)。

## 帮助与隐私

- [产品网站](https://linkvectorapp.com/albumdone)
- [使用支持](https://linkvectorapp.com/albumdone-support) · [info@linkvectorapp.com](mailto:info@linkvectorapp.com)
- [隐私政策](PRIVACY.md) · [文件操作提示](DISCLAIMER.md)
- [反馈问题](https://github.com/BlueVenn6/AlbumDone/issues) · [私下报告安全问题](SECURITY.md)

## 开发与贡献

环境配置、开发、测试和打包步骤见[贡献指南](CONTRIBUTING.md#简体中文)。技术说明另见[构建来源](RELEASE_SOURCES.md)、[性能检查](docs/PERFORMANCE.md)和[截图来源](docs/assets/screenshots/README.md)。

许可证：[MIT](LICENSE)。
