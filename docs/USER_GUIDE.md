# AlbumDone User Guide / 使用指南

Official downloads: <https://github.com/BlueVenn6/AlbumDone/releases>

This guide applies to the verified Windows desktop edition. Android and iOS
are not public releases yet.

本指南适用于已经公开的 Windows 桌面版。Android 和 iOS 目前尚未作为公开版本发布。

---

## English

### 1. Before You Start

- Use Windows 10 or Windows 11 on an x64 computer.
- Back up important photos before reviewing or deleting files.
- Download AlbumDone only from the official GitHub Releases page above.
- Do not send API keys, private photos, or local file paths in public bug
  reports.

AlbumDone supports common image formats including JPEG, PNG, GIF, WebP, AVIF,
HEIC/HEIF, TIFF, and BMP. A damaged, offline, or unsupported file may be
skipped and reported by the application.

### 2. Download And Install

1. Open the official GitHub Releases page.
2. Select the latest Windows release and download its `.exe` installer.
3. If the release provides `SHA256SUMS.txt`, verify the installer in
   PowerShell:

   ```powershell
   Get-FileHash -Algorithm SHA256 .\AlbumDone-*.exe
   ```

4. Compare the displayed hash with the value on the same GitHub Release.
5. Run the installer and follow the installation prompts.

Code signing is currently pending. Until a signed release is published,
Windows may identify the publisher as unknown. Do not bypass a security
warning for a file obtained from email attachments, mirrors, or any location
other than the official repository. After SignPath signing is enabled, verify
that Windows reports a valid publisher before installation.

### 3. Add A Photo Folder

1. Open AlbumDone.
2. Select **Library**.
3. Select **Browse Folder...**.
4. Choose the folder containing the photos you want to organize.
5. Wait for the folder summary to show the photo count and total size.
6. Confirm that the selected folder and count are correct before opening a
   tool.

AlbumDone processes the selected folder. If you switch folders, confirm the
current folder shown on the Library screen before starting another task.

### 4. Auto Dedup

Use Auto Dedup to find exact duplicates and highly similar photos.

1. Select the correct folder in **Library**.
2. Open **Auto Dedup**.
3. Select `50`, `100`, `200`, `500`, **Custom**, or **All**.
4. Select **Start analysis**.
5. Keep the application open while scanning and hashing are in progress.
6. Review every similar-photo group. A similarity result is a review aid, not
   proof that two files are interchangeable.
7. Check which photo is marked **Keeping** and which photo is selected for
   deletion.
8. Change the selection when needed.
9. Select **Confirm Delete** only after reviewing the selected files.

Deletion prefers the Windows Recycle Bin. If the system trash operation is not
available, AlbumDone may use a `.photo-manager-trash` folder beside the photo
folder and will report that location. A file that fails to move must remain in
the library and be reported as a failure.

### 5. Manual Culling

Use Manual Culling when you want to decide photo by photo.

1. Open **Manual Culling** for the selected folder.
2. Choose a batch size or **All**.
3. Start culling.
4. Mark each photo as **Keep** or **Delete**. You can switch between the single
   photo and grid views and use **Undo** when necessary.
5. At the end, review the totals.
6. Confirm deletion only when you are satisfied with the marked set.

Leaving without confirming deletion must not be treated as a completed disk
delete.

### 6. Screenshots And Optional AI

The Screenshots tool first identifies screenshot candidates from the selected
folder. Local organization does not require an AI key.

Available AI-assisted actions include text extraction, translation, key point
and TODO extraction, summarization, rewriting, and custom instructions.

To configure AI:

1. Open **Settings**.
2. Expand the provider you use.
3. Enter your own API key.
4. Keep the provider's default Base URL unless your provider account requires a
   specific workspace URL or you intentionally use a trusted Custom Endpoint.
5. Select the API type and model supported by your account.
6. Select **Test Connection**.
7. Save the configuration after the test succeeds.
8. Select the default provider for **Vision tasks (screenshots)** and, when
   needed, **Text tasks**.

When you execute an AI action, the current screenshot and instruction are sent
to the provider or endpoint you selected. AlbumDone's developer does not
receive the request. Provider charges and privacy terms still apply.

Never put an API key in a Base URL, query parameter, screenshot, issue, or log.

### 7. Year In Review

1. Select a photo folder from Library.
2. Open **Year in Review**.
3. Choose **Past 12 Months** or **This Year**.
4. Select **Generate Year in Review**.
5. Wait for generation to finish, then select **Open File**.

The exported image follows the application's current language. Months without
usable photos use an explicit placeholder rather than pretending that a
placeholder is one of the user's photos.

### 8. Language

AlbumDone follows the Windows system language. The current desktop application
does not provide an in-app language switcher. Supported interface languages
include English, Simplified Chinese, and Traditional Chinese.

### 9. Troubleshooting

- **The folder count looks wrong:** return to Library, select the folder again,
  and wait for scanning to finish. Record the displayed folder path and counts
  if the mismatch remains.
- **A thumbnail does not load:** retry the item. The source may be offline,
  damaged, locked, or unsupported by the local decoder.
- **AI connection fails:** check the provider, API type, Base URL, model name,
  key permissions, account quota, and network access. Do not publish the key.
- **Deletion fails:** close other applications that may be using the file,
  check file permissions, and retry. AlbumDone must not report a failed file as
  deleted.
- **The application stops responding:** do not force deletion operations.
  Record the selected folder size, current task, progress, and Windows version
  before reporting the issue.

Report reproducible issues at:
<https://github.com/BlueVenn6/AlbumDone/issues>

---

## 中文

### 1. 使用前准备

- 使用 Windows 10 或 Windows 11 x64 电脑。
- 在整理或删除照片前，先备份重要照片。
- 只从本文顶部的官方 GitHub Releases 页面下载 AlbumDone。
- 不要在公开问题、截图或日志中提交 API Key、私人照片或本地文件路径。

AlbumDone 支持 JPEG、PNG、GIF、WebP、AVIF、HEIC/HEIF、TIFF、BMP 等常见
图片格式。损坏、离线或无法解码的文件可能会被跳过，软件应显示相应提示。

### 2. 下载与安装

1. 打开官方 GitHub Releases 页面。
2. 选择最新 Windows 版本，下载 `.exe` 安装程序。
3. 如果 Release 提供 `SHA256SUMS.txt`，在 PowerShell 中执行：

   ```powershell
   Get-FileHash -Algorithm SHA256 .\AlbumDone-*.exe
   ```

4. 将结果与同一个 GitHub Release 中公布的 SHA-256 对比。
5. 运行安装程序并按照提示完成安装。

目前公共代码签名仍在申请中。签名版本发布前，Windows 可能显示“未知发布者”。
不要绕过来自邮件附件、镜像网站或非官方来源文件的安全警告。SignPath 签名启用
后，安装前应确认 Windows 显示有效发布者。

### 3. 添加照片文件夹

1. 打开 AlbumDone。
2. 进入 **Library / 图片库**。
3. 点击 **Browse Folder... / 浏览文件夹**。
4. 选择需要整理的照片文件夹。
5. 等待文件夹摘要显示照片数量和总大小。
6. 进入任何功能前，确认当前文件夹及数量正确。

切换文件夹后，应先在 Library 页面确认当前文件夹，再开始新的任务。

### 4. 自动查重

自动查重用于寻找完全重复或高度相似的图片。

1. 在 Library 中选择正确文件夹。
2. 打开 **Auto Dedup / 自动查重**。
3. 选择 `50`、`100`、`200`、`500`、**Custom / 自定义** 或 **All / 全部**。
4. 点击 **Start analysis / 开始分析**。
5. 扫描和哈希处理中保持软件运行。
6. 逐组检查相似图片。相似结果只是辅助判断，不代表两张图片一定可以互相替代。
7. 检查 **Keeping / 保留** 和待删除图片是否正确。
8. 必要时手动调整选择。
9. 全部确认后再点击 **Confirm Delete / 确认删除**。

软件优先将文件移入 Windows 回收站。如果系统回收站不可用，可能会在照片文件夹
旁使用 `.photo-manager-trash`，并提示实际路径。删除失败的文件必须继续保留并显示
失败原因。

### 5. 手动筛选

1. 为当前文件夹打开 **Manual Culling / 手动筛选**。
2. 选择处理数量或 **All / 全部**。
3. 开始筛选。
4. 将照片标记为 **Keep / 保留** 或 **Delete / 删除**。可以切换单张和网格模式，
   需要时使用 **Undo / 撤销**。
5. 完成后检查统计数量。
6. 确认待删除集合正确后再执行删除。

没有确认删除就退出时，不应被视为已经从磁盘删除。

### 6. 截图整理与可选 AI

截图功能会先从当前文件夹中筛选截图候选。仅进行本地截图整理不需要 API Key。

AI 可选功能包括文字提取、翻译、提取重点和待办事项、摘要、改写及自定义指令。

配置方法：

1. 打开 **Settings / 设置**。
2. 展开需要使用的模型供应商。
3. 填写自己的 API Key。
4. 一般保留供应商默认 Base URL；只有供应商账号要求工作空间地址，或你明确使用
   可信 Custom Endpoint 时才修改。
5. 选择账号实际支持的 API 类型和模型。
6. 点击 **Test Connection / 测试连接**。
7. 测试成功后保存。
8. 为 **Vision tasks / 视觉任务** 选择默认模型，需要时也为文本任务选择模型。

执行 AI 操作时，当前截图和指令会发送给你选择的模型供应商或 Endpoint，AlbumDone
开发者不会接收这些内容。供应商的费用和隐私条款仍然适用。

不要把 API Key 放入 Base URL、查询参数、截图、Issue 或日志。

### 7. 年度回看

1. 在 Library 中选择照片文件夹。
2. 打开 **Year in Review / 年度回看**。
3. 选择 **Past 12 Months / 过去 12 个月** 或 **This Year / 本年**。
4. 点击生成。
5. 完成后点击 **Open File / 打开文件** 查看导出图片。

导出语言跟随应用当前语言。没有可用照片的月份应显示明确的占位卡片，不能把占位
内容伪装成用户照片。

### 8. 界面语言

AlbumDone 跟随 Windows 系统语言。当前桌面版没有应用内语言切换按钮。界面支持
英文、简体中文和繁体中文。

### 9. 常见问题

- **照片数量不一致：** 返回 Library，重新选择文件夹并等待扫描结束。如果仍不一致，
  记录文件夹路径、页面数量和任务输入数量。
- **缩略图不显示：** 重试该图片。源文件可能离线、损坏、被占用或无法解码。
- **AI 连接失败：** 检查供应商、API 类型、Base URL、模型名、Key 权限、账号额度和
  网络，不要公开 API Key。
- **删除失败：** 关闭可能占用图片的其他软件，检查文件权限后重试。失败文件不应被
  显示为已删除。
- **软件无响应：** 不要强制继续删除操作。记录文件夹规模、当前功能、进度和 Windows
  版本后再提交问题。

可复现问题提交地址：
<https://github.com/BlueVenn6/AlbumDone/issues>

