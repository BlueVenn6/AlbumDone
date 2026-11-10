# Contributing to AlbumDone

[English](#english) | [简体中文](#简体中文)

## English

### Setup

This repository contains the Windows desktop application in `packages/desktop` and its shared code in `packages/shared`.

Use Windows x64 and Git. The tested toolchain is Node.js **22.23.4** and npm **12.2.2**; `package.json` requires Node.js 22.22.2 or newer and pins npm 12.2.2. Use that npm version before installing so dependency overrides resolve consistently with the lockfile.

Run the following commands from the repository root:

```powershell
npm ci
npm run dev:desktop
```

### Check changes

```powershell
npm run lint
npm run typecheck
npm run test
npm --workspace @photo-manager/desktop run build
npm --workspace @photo-manager/desktop run test:e2e
npm audit --audit-level=low
```

The Electron acceptance test requires a Windows desktop session. It creates synthetic photos and a separate application profile. It does not use your photo library. Performance checks are described in [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

Keep changes focused and describe their user-visible effect and relevant validation in your pull request. Report ordinary bugs in [GitHub Issues](https://github.com/BlueVenn6/AlbumDone/issues); follow [SECURITY.md](SECURITY.md) for security reports. Do not attach private photos, credentials or sensitive logs.

### Package and verify

Commit the tested source before packaging. The packaging script requires a clean Git working tree:

```powershell
npm --workspace @photo-manager/desktop run package
```

The script cleans generated packaging output, builds the shared code and Electron main/preload/renderer, embeds `dist/build-source.json`, and writes the installer and SHA-256 `build-record.json` to `packages/desktop/release`.

To check the exact packaged application instead of the development build:

```powershell
$env:ALBUMDONE_ACCEPTANCE_EXE = (Resolve-Path packages/desktop/release/win-unpacked/AlbumDone.exe).Path
npm --workspace @photo-manager/desktop run test:e2e
Remove-Item Env:ALBUMDONE_ACCEPTANCE_EXE
```

These checks exercise the packaged application. Installing the final installer, upgrading an existing installation and verifying code signatures are separate release checks. A successful build alone does not establish their results. Record validation against the exact distributed file; signing changes its checksum.

See [build provenance](RELEASE_SOURCES.md), [release history](CHANGELOG.md), [code signing policy](CODE_SIGNING_POLICY.md) and the [release-notes template](docs/RELEASE_NOTES_TEMPLATE.md).

## 简体中文

### 配置环境

本仓库包含 `packages/desktop` 中的 Windows 桌面应用，以及 `packages/shared` 中的共享代码。

使用 Windows x64 和 Git。已测试的工具链为 Node.js **22.23.4**、npm **12.2.2**；`package.json` 要求 Node.js 不低于 22.22.2，并指定 npm 12.2.2。安装依赖前请使用该 npm 版本，确保依赖覆盖规则与锁文件的解析一致。

在仓库根目录运行：

```powershell
npm ci
npm run dev:desktop
```

### 检查修改

```powershell
npm run lint
npm run typecheck
npm run test
npm --workspace @photo-manager/desktop run build
npm --workspace @photo-manager/desktop run test:e2e
npm audit --audit-level=low
```

Electron 界面测试需要 Windows 桌面会话，使用自动生成的测试照片和独立应用数据目录，不读取您的照片库。性能检查见[性能检查说明](docs/PERFORMANCE.md)。

请保持修改范围明确，在 Pull Request 中说明用户能看到的变化和相关验证。普通问题通过 [GitHub Issues](https://github.com/BlueVenn6/AlbumDone/issues) 反馈，安全问题按[安全政策](SECURITY.md)私下报告。请勿附上私人照片、凭据或敏感日志。

### 打包与核对

先提交已测试的源码，打包脚本要求 Git 工作区干净：

```powershell
npm --workspace @photo-manager/desktop run package
```

脚本清理自动生成的打包输出，构建共享代码及 Electron 主进程、预加载和渲染器，将源码身份写入 `dist/build-source.json`。安装包和含 SHA-256 的 `build-record.json` 输出到 `packages/desktop/release`。

检查实际打包的程序时运行：

```powershell
$env:ALBUMDONE_ACCEPTANCE_EXE = (Resolve-Path packages/desktop/release/win-unpacked/AlbumDone.exe).Path
npm --workspace @photo-manager/desktop run test:e2e
Remove-Item Env:ALBUMDONE_ACCEPTANCE_EXE
```

这些检查针对包内程序；最终安装器的系统安装、覆盖升级和代码签名需要另行核对，构建成功不能代替这些结果。发布时应记录实际分发文件的验证结果；签名会改变文件校验值。

另见[构建来源](RELEASE_SOURCES.md)、[发布记录](CHANGELOG.md)、[代码签名政策](CODE_SIGNING_POLICY.md)和[发布说明模板](docs/RELEASE_NOTES_TEMPLATE.md)。
