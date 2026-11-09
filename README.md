# 记账本

一个离线的个人记账本，提供单文件网页版和 Android App。账本保存在当前设备的浏览器或 App 内，可以通过 JSON 备份迁移。

## 功能

- **账户和余额**。默认提供支付宝、工商银行和微信。在「余额 → 账户管理」可添加现金、银行卡等账户。新增账户从 0 开始，在「记余额」可填写实际余额。留空的账户继续沿用原余额。
- **收支和分类**。记一笔时选择账户和分类，支持自定义收入、支出分类。可在「数据与备份 → 分类管理」添加、改名、停用和恢复分类。
- **余额联动**。开启自动更新时，每笔收支会计入对应账户。每个账户以自己最近一次手记余额为起点，快照当天及之前的收支视为已计入该快照。
- **报表**。查看月度收支、分类占比和各账户的余额走势。
- **备份**。可导出完整 JSON、流水 CSV 和余额 CSV，也可从 JSON 合并或覆盖恢复。

## 使用

### 网页版

直接用浏览器打开 `index.html`，也可把它放到静态网站上。网页版按浏览器和页面地址保存数据。更新时继续使用原来的地址，可访问已有账本。

### Android

支持 Android 10 及以上。将构建出的 `sanyu-ledger.apk` 发到手机安装。升级已有 App 时，请使用同一签名密钥构建，并直接覆盖安装。

### 备份与迁移

在原设备打开「数据与备份」，导出「完整备份（JSON）」。在目标设备打开「导入完整备份（JSON）」，选择该文件并预览。

- **合并**保留当前账本，补充缺少的流水、快照、账户和分类。不同 ID 的同名自定义账户会分别保留，以免把两边的余额混到一起。
- **覆盖**用备份恢复账本和设置。适合从空账本恢复。

旧版 JSON 备份可在新版中导入。浏览器版和 Android App 各自保存数据，可用同一份完整备份迁移。

## 构建

### 网页版

安装 Node.js 后在项目根目录运行。无需安装 npm 依赖。

```sh
node build.mjs
```

生成的 `index.html` 已随源码提供。修改 `src/` 后重新构建即可。

### Android APK

在 Windows 上安装 Node.js 和 JDK 17，然后在项目根目录运行以下命令。

```powershell
.\android\setup-sdk.cmd
.\android\build-apk.cmd
```

首次运行环境脚本会安装 Android SDK Platform 34 和 Build Tools 34.0.0。已有这些组件时，可以直接运行构建脚本。构建会重新打包网页，在项目根目录生成已签名的 `sanyu-ledger.apk`。

首次构建会在本地生成签名材料。后续发布同一 App 的升级包时，需要保留并使用原来的 `android/keystore/`。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `src/shell.html` | 页面结构 |
| `src/styles.css` | 移动端样式 |
| `src/app.js` | 账本逻辑和本地存储 |
| `build.mjs` | 生成单文件网页 |
| `index.html` | 可直接打开或部署的网页 |
| `android/` | WebView 外壳、原生文件选择与导出、构建脚本 |

## 发布到 GitHub

在 GitHub 创建空仓库，把源码解压后在项目根目录执行以下命令。将最后两行中的远程地址替换为你的仓库地址。

```sh
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/USERNAME/REPO.git
git push -u origin main
```

`.gitignore` 已排除默认名称的账本导出、签名材料、APK 和 Android 构建目录。公开仓库只需上传源码。如果要提供安卓下载，可以把签好的 APK 上传到仓库的 Releases。
