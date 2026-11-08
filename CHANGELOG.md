# AlbumDone 0.2.1

## English

### Source publication

This record accompanies the public 0.2.1 desktop source update. It does not
publish a GitHub Release, upload an installer, or create a signed build.
The existing unsigned artifact is identified below. Mobile releases are
maintained separately.

### Changes verified in the packaged application

- Manual review: restore mouse-accessible Previous/Next controls and undo;
  remove duplicate action hints. Browsing does not mark a photo as reviewed.
- Duplicate review: distinguish the large group-member preview from actual
  photo counts. Support changing the keeper, keeping the whole group and
  cancelling individual deletion selections with separate controls.
- Batch navigation: return to quantity selection after a no-match batch;
  retain folder progress and allow checking the remaining photos.
- Language switching: preserve review choices instead of restarting photo
  loading. Check fifteen languages at two window widths, including a
  thirty-photo duplicate group.
- Year in Review: show the selected date range and generation state; export
  the current month choices to JPG with readable Chinese text. Native export
  checks cover all fifteen languages.
- Sidebar: restore the local-processing, upload and deletion-confirmation
  explanations in all fifteen languages.
- Installer: declare per-monitor DPI awareness and use Segoe UI. The real
  installer was visually inspected at the test machine's 225% display scale.

The 0.2.x desktop removes the earlier AI-provider integrations, remote model
requests, API-key management, screenshot instructions and OCR. Git history
retains earlier versions; the current application does not include those
integrations.

### Artifact identity and acceptance scope

| Item | Recorded value |
| --- | --- |
| Version / architecture | 0.2.1 / Windows x64 |
| Runtime source commit | `e493d1a6b226a326216cb44849e7ff1a8618b900` |
| Build ID | `20261108T030324Z-e493d1a6` |
| Installer | `AlbumDone-0.2.1-20261108T030324Z-e493d1a6-x64.exe` |
| Size | 140,194,973 bytes |
| SHA-256 | `691A41FB5697D4FA348773180541227017A4FA6833E4DFCBCBD747C9A401194D` |
| Authenticode | Unsigned |

The unsigned artifact's packaged runtime was launched and exercised through
the reported problem paths. Its 58 application runtime files matched the
production output, and all 231 files extracted from the installer matched the
packaging output. Recorded checks include real pointer interaction, all fifteen
languages, a saved Chinese JPG, and recycle-bin deletion of synthetic test
photos. The final runtime report records eight scenario groups and no runtime
errors.

This is **State D for the recorded packaged-runtime checks**. It is not a claim
that installation or upgrades passed. The installer options and directory
pages were inspected, then cancelled before installation. System installation,
overwriting an existing version and upgrades remain **State C**. SignPath
approval/configuration and a signed release have not been validated. The
checks do not cover every Windows version, display setup or photo format.

This documentation update does not change the runtime source, lockfile or
existing installer. A future signed build needs a new provenance record,
post-signing checksum and acceptance of that exact artifact. See
[release provenance](RELEASE_SOURCES.md), [Code signing policy](CODE_SIGNING_POLICY.md)
and [privacy](PRIVACY.md).

## 简体中文

### 本次公开内容

本记录随 0.2.1 桌面源码更新公开，不创建 GitHub Release、不上传安装包，也不生成签名版本。
现有未签名安装包的名称、运行源码提交、大小和 SHA-256 见上表。手机版本独立维护。

### 安装包内已经验收的变更

- 手动筛选恢复可用鼠标点击的上一张/下一张及撤销，移除重复操作提示；浏览不会自动标记为已审阅。
- 自动去重明确大图只是组内照片预览，提供独立的预览、更换保留、整组保留和取消待删除操作。
- 零重复批次结束后可返回数量选择，保留文件夹进度并继续检查剩余照片。
- 切换语言保留审阅选择，避免重新加载照片导致任务重启；检查 15 种语言、两种窗口宽度及 30 张重复照片的大组场景。
- 年度回顾显示范围选中和生成状态，按当前选择导出 JPG；中文导出文字可读，原生导出检查覆盖 15 种语言。
- 侧栏恢复本地处理、上传和删除确认的完整说明，15 种语言同步。
- 安装器声明按显示器感知 DPI 并使用 Segoe UI，在验收机器的 225% 显示缩放下查看了真实安装器。

0.2.x 桌面版移除旧版的 AI 服务商接入、远程模型请求、密钥管理、截图指令及 OCR。
Git 历史保留旧版本，当前应用不包含这些接入。

### 验收边界

现有安装包内的真实程序已经启动，并按原始问题路径操作；58 个应用运行文件与生产输出一致，
安装包解出的 231 个文件与打包输出一致。记录覆盖鼠标点击、15 种语言、实际保存的中文 JPG，
以及合成测试照片的系统回收站删除。最终运行报告包含 8 类场景，未记录运行异常。

上述已记录的包内运行检查属于 **State D**。安装器只查看了选项页和目录页，随后在安装前取消；
系统安装、覆盖安装和升级仍属于 **State C**。SignPath 审批、配置和签名版本尚未验证，
也没有覆盖所有 Windows 版本、显示器组合或照片格式。

本次只更新文档，不改变运行源码、锁文件和现有安装包。后续签名版本必须重新记录构建来源、
签名后的哈希，并验收该确切交付物。参见[构建来源](RELEASE_SOURCES.md)、
[代码签名政策](CODE_SIGNING_POLICY.md)和[隐私说明](PRIVACY.md)。
