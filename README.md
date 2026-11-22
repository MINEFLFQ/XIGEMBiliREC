# XIGEMBiliREC

<p align="center">
  <img src="public/logo.png" alt="XIGEMBiliREC Logo" width="200">
</p>

## Beta_0.2.1

基于 Node.js、Express 和 FFmpeg 的 Bilibili 直播录制与视频切片服务。

XIGEMBiliREC 可以监控指定的 Bilibili 直播间，在主播开播时自动录制直播流，并在录制结束后生成 HLS 预览视频。用户可以通过 Web 页面选择录制文件、提交视频切片任务、查看切片结果并下载视频。

项目同时提供命令行管理终端，用于管理用户、直播间、管理员密码以及服务运行状态。


---

## 更新说明 (Beta_0.2.1)

新增 B 站主播昵称获取与存储功能，支持通过房间号或主播昵称控制录制状态、查询直播间信息，并增加昵称定期检测机制，自动同步主播昵称变更。

## 更新说明 (Beta_0.2.0)

本次更新主要完成了项目的前端可视化控制台开发，打通了从底层录制到前端交互的完整链路。

- **全新 UI 体系**：开发了基于双主题（新拟物 / 玻璃拟态）的响应式 Web 页面，支持深浅色无缝切换。
- **播放与切片**：新增视频预览页，集成 HLS.js 实现 `.m3u8` 在线播放；提供友好的时间输入表单，支持实时轮询切片进度并下载产物。
- **媒体库与仪表盘**：新增主页数据概览与媒体库。媒体库支持对原片进行搜索筛选，并新增了“我的切片”管理面板，允许用户直接下载或删除自己的切片。
- **权限与安全**：前端页眉实现了动态权限渲染。普通用户不可见管理员入口，但允许通过直接访问 `/admin` 路由进行管理员密码的二次独立验证。
- **前后端联调优化**：修复了此前静态资源被登录中间件拦截导致的样式丢失问题；统一了全站路由路径与静态资源的绝对引用方式。

---

## 目录

- [1. 项目简介](#1-项目简介)
- [2. 功能特性](#2-功能特性)
- [3. 运行环境](#3-运行环境)
- [4. 项目目录结构](#4-项目目录结构)
- [5. 安装与启动](#5-安装与启动)
- [6. 配置文件说明](#6-配置文件说明)
- [7. 直播间管理](#7-直播间管理)
- [8. 自动录制机制](#8-自动录制机制)
- [9. HLS 预览转码机制](#9-hls-预览转码机制)
- [10. 视频切片机制](#10-视频切片机制)
- [11. 用户与权限管理](#11-用户与权限管理)
- [12. 管理员功能](#12-管理员功能)
- [13. 命令行终端](#13-命令行终端)
- [14. HTTP API](#14-http-api)
- [15. 文件存储与自动清理](#15-文件存储与自动清理)
- [16. 日志与运行状态](#16-日志与运行状态)
- [17. 服务关闭与重置](#17-服务关闭与重置)
- [18. 常见问题](#18-常见问题)
- [19. 开发者须知](#19-开发者须知)

---

## 1. 项目简介

XIGEMBiliREC 是一个面向 Bilibili 直播间的自动录制与视频切片服务。

项目使用 Node.js 作为后端运行环境，Express 提供 HTTP 服务，Axios 用于请求 Bilibili API，FFmpeg 负责直播流录制、视频转码和视频切片。

项目采用单文件后端结构，主要服务逻辑集中在 `server.js` 中。

基本工作流程：

```text
                  Bilibili 直播间
                         |
                         v
                  定时检查直播状态
                         |
                +--------+--------+
                |                 |
              未开播             已开播
                |                 |
                v                 v
              继续轮询         获取直播流地址
                                  |
                                  v
                              FFmpeg 录制
                                  |
                                  v
                              保存原始视频
                                  |
                                  v
                              录制结束
                                  |
                                  v
                              转码任务队列
                                  |
                                  v
                              FFmpeg HLS 转码
                                  |
                                  v
                           生成 m3u8 / ts 文件
                                  |
                                  v
                              Web 视频预览
                                  |
                                  v
                              用户提交切片
                                  |
                                  v
                              FFmpeg 切片
                                  |
                                  v
                              用户下载 MP4
```

---

## 2. 功能特性

### 2.1 直播录制

- 支持配置多个 Bilibili 直播间。
- 自动检测直播状态。
- 检测到开播后自动获取直播流地址。
- 使用 FFmpeg 录制直播流。
- 支持配置录制视频格式。
- 支持手动启用或停止指定直播间的录制。
- 支持录制异常后的自动重试。
- 支持连续失败后的冷却机制。

### 2.2 HLS 视频预览

- 原始录制文件完成后自动进入转码队列。
- 使用 FFmpeg 将原始视频转为 HLS。
- 生成 `index.m3u8` 播放列表。
- 生成多个 `.ts` 视频分片。
- 支持配置视频分辨率、帧率、码率、编码预设等参数。
- 服务启动时扫描未完成转码的录制文件，并尝试恢复任务。
- 支持转码队列容量限制、失败重试和录制冲突处理。

### 2.3 视频切片

- 用户可以从原始录制文件中选择开始时间和结束时间。
- 使用 FFmpeg 执行视频切片。
- 切片输出为 MP4。
- 支持切片任务排队。
- 支持配置并发切片数量。
- 支持用户每日切片次数限制。
- 支持用户切片文件数量限制。
- 支持切片文件自动清理。

### 2.4 用户系统

- 用户登录和退出。
- 管理员创建用户。
- 管理员重置用户密码。
- 管理员删除用户。
- 用户修改自己的密码。
- 用户会话持久化。

### 2.5 管理员功能

- 管理员独立密码验证。
- 删除指定直播间的原始录制文件。
- 删除原片前检查录制和切片任务状态。
- 取消对应转码任务。
- 删除原片对应的 HLS 预览目录。

### 2.6 命令行管理

提供交互式命令行终端，可以直接管理用户、直播间和服务运行状态。

### 2.7 自动清理

- 按照保留时间清理用户切片。
- 按照用户文件数量限制清理旧切片。
- 按照原片保留期限清理旧录制文件。
- 按照原片总容量限制清理旧录制文件。
- 清理原片时保护正在录制、转码或切片的文件。

---

## 3. 运行环境

### 必需环境

| 软件 | 用途 |
|---|---|
| Node.js | 运行后端服务 |
| npm | 安装 Node.js 依赖 |
| FFmpeg | 录制、转码和切片 |
| Express | 提供 HTTP 服务 |
| Axios | 请求 Bilibili API |

### Node.js 依赖

项目当前使用：

```bash
npm install express axios
```

### FFmpeg

FFmpeg 是项目运行所必需的外部程序。

需要确保 FFmpeg 可以被 Node.js 的 `spawn()` 正常调用。

可以通过以下命令检查：

```bash
ffmpeg -version
```

如果使用系统环境变量中的 FFmpeg，配置文件可以使用：

```json
{
  "ffmpeg": {
    "path": "ffmpeg"
  }
}
```

如果 FFmpeg 没有加入系统 PATH，则可以填写可执行文件的完整路径，例如：

```json
{
  "ffmpeg": {
    "path": "C:/ffmpeg/bin/ffmpeg.exe"
  }
}
```

注意：修改 FFmpeg 路径后，需要重新启动服务。

---

## 4. 项目目录结构

项目初始目录：

```text
XIGEMBiliREC/
│
├── server.js
├── package.json
├── package-lock.json
│
├── config/
│   ├── server.json
│   ├── server.example.json
│   ├── runtime.json
│   └── rooms.json
│
├── public/
│   ├── index.html
│   ├── login.html
│   ├── video.html
│   ├── list.html
│   └── admin.html
│
├── public-static/
│
├── user/
│   ├── recordings/
│   ├── previews/
│   ├── tempvideo/
│   ├── log/
│   │   └── server.log
│   ├── sessions.json
│   └── stats.json
│
└── node_modules/
```

说明：

| 路径 | 用途 |
|---|---|
| `server.js` | 后端主程序 |
| `package.json` | Node.js 项目依赖和启动脚本 |
| `config/server.json` | 服务运行配置 |
| `config/server.example.json` | 示例服务配置 |
| `config/runtime.json` | 用户、管理员密码和下载密钥 |
| `config/rooms.json` | 直播间配置 |
| `public/` | Web 页面 |
| `public-static/` | 无需登录即可访问的静态资源 |
| `user/recordings/` | 原始直播录制文件 |
| `user/previews/` | HLS 预览文件 |
| `user/tempvideo/` | 用户生成的切片文件 |
| `user/log/` | 服务日志 |
| `user/sessions.json` | 登录会话 |
| `user/stats.json` | 用户切片统计 |

首次启动时，程序会自动创建必要的目录和 JSON 配置文件。

---

## 5. 安装与启动

### 5.1 获取项目

下载或克隆项目到本地：

```bash
git clone <项目仓库地址>
```

进入项目目录：

```bash
cd XIGEMBiliREC
```

### 5.2 安装依赖

```bash
npm install express axios
```

### 5.3 检查 FFmpeg

```bash
ffmpeg -version
```

如果命令无法识别，请安装 FFmpeg，或者在 `config/server.json` 中配置 FFmpeg 的完整路径。

### 5.4 启动服务

```bash
node server.js
```

启动过程中，程序会：

1. 初始化日志系统。
2. 创建项目运行所需目录。
3. 创建缺失的 JSON 配置文件。
4. 读取服务配置和直播间配置。
5. 检查配置是否合法。
6. 启动 Express HTTP 服务。
7. 启动命令行管理终端。
8. 恢复未完成的转码任务。
9. 启动直播间状态轮询。
10. 执行一次清理任务，并启动定时清理。

默认服务地址：

```text
http://127.0.0.1:3001
```

实际访问地址取决于 `server.json` 中的 `server.host` 和 `server.port`。

---

## 6. 配置文件说明

### 6.1 server.json

`server.json` 用于配置服务运行参数。

默认配置：

```json
{
  "server": {
    "port": 3001,
    "host": "127.0.0.1",
    "basePath": "/"
  },

  "paths": {
    "recordings": "./user/recordings",
    "previews": "./user/previews",
    "tempvideo": "./user/tempvideo"
  },

  "ffmpeg": {
    "path": "ffmpeg"
  },

  "recorder": {
    "outputFormat": "mkv",
    "pollInterval": 60000,
    "pollJitter": 15000,
    "retryInterval": 300000,
    "retryMax": 5,

    "headers": {
      "Referer": "https://live.bilibili.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  },

  "previewTranscode": {
    "enabled": true,
    "scale": "640:360",
    "fps": 15,
    "videoBitrate": "300k",
    "maxrate": "350k",
    "bufsize": "600k",
    "preset": "veryslow",
    "profile": "high",
    "audioBitrate": "48k",
    "audioSampleRate": 44100,
    "hlsSegmentTime": 6,
    "maxAttempts": 2,
    "recoverIntervalMinutes": 60
  },

  "transcodeConflict": {
    "policy": "slowdown",
    "slowdown": {
      "threads": 2
    },
    "pause": {
      "requeueDelaySeconds": 300
    }
  },

  "clip": {
    "maxFiles": 5,
    "maxHardLimit": 10,
    "retentionHours": 6,
    "cleanupIntervalMinutes": 5,
    "dailyLimit": 10,
    "maxConcurrent": 1,
    "maxConcurrentDownloads": 3
  },

  "storage": {
    "rawRetention": {
      "maxAgeDays": 30,
      "maxTotalGB": 2000,
      "checkIntervalHours": 6
    }
  }
}
```

### 6.2 服务配置

| 参数 | 默认值 | 说明 |
|---|---|---|
| `server.port` | `3001` | HTTP 服务端口 |
| `server.host` | `127.0.0.1` | HTTP 监听地址 |
| `server.basePath` | `/` | Web 服务基础路径 |
| `paths.recordings` | `./user/recordings` | 原始录制文件目录 |
| `paths.previews` | `./user/previews` | HLS 预览目录 |
| `paths.tempvideo` | `./user/tempvideo` | 用户切片目录 |
| `ffmpeg.path` | `ffmpeg` | FFmpeg 可执行程序路径 |

如果需要允许其他设备访问，应根据实际网络环境修改 `server.host`，并配置好防火墙和访问控制。

### 6.3 录制配置 recorder

| 参数 | 默认值 | 说明 |
|---|---|---|
| `outputFormat` | `mkv` | 原始录制文件格式 |
| `pollInterval` | `60000` | 直播状态轮询间隔，单位毫秒 |
| `pollJitter` | `15000` | 轮询随机延迟范围，单位毫秒 |
| `retryInterval` | `300000` | 录制失败重试基础间隔 |
| `retryMax` | `5` | 最大连续失败次数 |
| `headers` | 默认浏览器请求头 | 获取直播流时使用的 HTTP 请求头 |

轮询实际间隔会在基础间隔上增加随机延迟。

录制异常后采用逐步增加的重试间隔，最长不超过 30 分钟。超过连续失败次数限制后进入冷却状态。

### 6.4 HLS 转码配置 previewTranscode

| 参数 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 是否启用预览转码 |
| `scale` | `640:360` | 视频缩放分辨率 |
| `fps` | `15` | 输出帧率 |
| `videoBitrate` | `300k` | 视频目标码率 |
| `maxrate` | `350k` | 视频最大码率 |
| `bufsize` | `600k` | 视频缓冲区大小 |
| `preset` | `veryslow` | H.264 编码预设 |
| `profile` | `high` | H.264 编码 Profile |
| `audioBitrate` | `48k` | 音频码率 |
| `audioSampleRate` | `44100` | 音频采样率 |
| `hlsSegmentTime` | `6` | HLS 分片目标时长，单位秒 |
| `maxAttempts` | `2` | 转码最大尝试次数 |
| `recoverIntervalMinutes` | `60` | 配置中的恢复间隔参数 |

转码使用 H.264 视频编码和 AAC 音频编码。

注意：当前代码在服务启动时执行一次未完成转码任务恢复扫描；`recoverIntervalMinutes` 虽然存在于默认配置中，但当前展示的代码没有使用它建立周期性恢复任务。

### 6.5 转码冲突配置 transcodeConflict

当有其他直播间正在录制时，可以选择转码处理策略。

| 参数 | 默认值 | 说明 |
|---|---|---|
| `policy` | `slowdown` | 转码冲突策略 |
| `slowdown.threads` | `2` | 降低转码线程数量 |
| `pause.requeueDelaySeconds` | `300` | 暂停后重新排队的等待时间 |

支持的策略：

**slowdown**

录制期间允许转码，但可以限制转码线程数量。

**pause**

如果检测到其他录制任务，则暂缓转码，并在指定时间后重新排队。

### 6.6 切片配置 clip

| 参数 | 默认值 | 说明 |
|---|---|---|
| `maxFiles` | `5` | 每个用户允许保留的切片文件数量 |
| `maxHardLimit` | `10` | 每个用户切片文件数量硬限制 |
| `retentionHours` | `6` | 切片文件保留时间 |
| `cleanupIntervalMinutes` | `5` | 清理任务执行间隔 |
| `dailyLimit` | `10` | 每个用户每日切片次数 |
| `maxConcurrent` | `1` | 同时执行的切片任务数量 |
| `maxConcurrentDownloads` | `3` | 同一用户最大并发下载数量 |

### 6.7 原始录制文件清理配置 rawRetention

| 参数 | 默认值 | 说明 |
|---|---|---|
| `maxAgeDays` | `30` | 原始录制文件最长保留天数 |
| `maxTotalGB` | `2000` | 原始录制文件总容量上限 |
| `checkIntervalHours` | `6` | 原片清理检查间隔 |

原片清理优先处理超过保留期限的文件，再检查总容量是否超限。

正在录制、转码、排队转码或正在切片的文件会受到保护。

---

## 7. 直播间管理

直播间配置保存在：

```text
config/rooms.json
```

默认结构：

```json
{
  "rooms": [
    {
      "id": "demo",
      "roomId": 2233,
      "name": "示例房间",
      "quality": 10000,
      "enabled": false
    }
  ]
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `id` | 项目内部使用的房间标识 |
| `roomId` | Bilibili 直播间号码 |
| `name` | 直播间名称 |
| `quality` | 请求的直播画质参数 |
| `enabled` | 是否启用自动录制 |

推荐通过终端命令管理直播间，而不是手动修改配置文件。

添加直播间：

```text
room add <房间号>
```

添加时程序会请求 Bilibili API 获取直播间信息，并保存真实房间 ID、名称等信息。

启用录制：

```text
room rec <房间号> true
```

停止录制：

```text
room rec <房间号> false
```

查看直播间状态：

```text
room list <房间号>
```

删除直播间：

```text
room delete <房间号>
```

注意：删除直播间配置不等于删除该直播间已经录制的视频文件。

---

## 8. 自动录制机制

服务启动后，程序会定时检查已启用的直播间。

### 8.1 开播检测

当直播间状态为开播时，程序会：

1. 请求 Bilibili API 获取直播流地址。
2. 根据直播间配置选择画质。
3. 调用 FFmpeg。
4. 将直播流保存为原始录制文件。

录制文件命名格式：

```text
<房间ID>_<日期>_<序号>.<格式>
```

例如：

```text
2233_20261121_0.mkv
2233_20261121_1.mkv
```

同一房间、同一天的文件序号会递增。

### 8.2 下播检测

如果直播间正在录制，轮询任务会继续检查直播状态。

检测到下播后，程序会向 FFmpeg 发送停止指令。

录制结束后：

- 统计录制文件大小。
- 删除过小的异常文件。
- 对有效录制文件触发 HLS 转码任务。

### 8.3 异常重试

录制异常时，程序会累计失败次数。

重试间隔逐步增加，并设置最大等待时间。

连续失败超过配置上限后，直播间进入冷却状态。冷却结束后恢复轮询。

---

## 9. HLS 预览转码机制

原始录制完成后，程序会把文件加入转码队列。

默认最大等待队列容量为：

```text
100
```

转码队列会检查重复任务，避免同一原片被重复加入队列或同时执行转码。

### 9.1 HLS 文件结构

假设原片为：

```text
user/recordings/2233/2233_20261121_0.mkv
```

对应的预览文件目录为：

```text
user/previews/
└── 2233/
    └── 2233_20261121_0/
        ├── index.m3u8
        ├── seg_00000.ts
        ├── seg_00001.ts
        ├── seg_00002.ts
        └── ...
```

其中：

- `index.m3u8`：HLS 播放列表。
- `seg_*.ts`：实际视频分片。

### 9.2 转码失败重试

转码失败后，程序会根据 `previewTranscode.maxAttempts` 判断是否重新尝试。

默认最多尝试 2 次，重试等待时间为 10 分钟。

达到最大尝试次数后，记录错误日志。

### 9.3 服务启动恢复

启动时，程序会扫描原始录制目录。

如果某个原片没有对应的：

```text
index.m3u8
```

并且没有正在执行或等待执行的转码任务，就会尝试重新加入转码队列。

这样可以处理服务意外退出后留下的未完成转码文件。

---

## 10. 视频切片机制

用户可以通过 Web 页面选择原始录制文件，并输入开始时间和结束时间。

切片使用 FFmpeg 执行，当前采用流复制方式：

```text
-c copy
```

这种方式通常比重新编码更快，但切片起点可能受到视频关键帧位置影响。

### 10.1 时间格式

支持：

```text
HH:MM:SS
MM:SS
秒数
```

例如：

```text
01:30:00
90:00
5400
```

对于纯数字输入，程序还支持紧凑时间格式：

```text
123456
```

表示：

```text
12:34:56
```

### 10.2 切片文件命名

输出格式：

```text
日期_原片序号_开始时间_结束时间.mp4
```

例如：

```text
20261121_0_010000_010500.mp4
```

### 10.3 切片任务状态

每个切片任务具有以下状态：

| 状态 | 说明 |
|---|---|
| `queued` | 等待执行 |
| `running` | 正在切片 |
| `done` | 切片完成 |
| `failed` | 切片失败 |

任务状态通过任务 ID 查询。

### 10.4 切片限制

切片任务受到以下限制：

- 每日切片次数限制。
- 每用户切片文件数量限制。
- 最大并发切片数量。
- 原始录制文件必须存在。
- 原片正在删除时不允许提交切片任务。

---

## 11. 用户与权限管理

用户数据保存在：

```text
config/runtime.json
```

程序保存密码哈希，而不是明文密码。

用户登录成功后，程序会生成随机 Session ID，并通过 HTTP Cookie 维护登录状态。

### 会话有效期

| 类型 | 有效期 |
|---|---|
| 普通登录会话 | 7 天 |
| 管理员验证状态 | 30 分钟 |

### 用户权限

普通用户可以：

- 登录和退出。
- 查看录制文件。
- 提交视频切片。
- 查询自己的切片任务。
- 下载自己的切片文件。
- 删除自己的切片文件。
- 修改自己的密码。

普通用户不能：

- 删除原始录制文件。
- 修改管理员密码。
- 管理其他用户。

---

## 12. 管理员功能

管理员密码保存在：

```text
config/runtime.json
```

首次启动时，如果不存在 `runtime.json`，程序会生成默认管理员密码：

```text
XIGEMBiliREC
```

请在首次部署后及时修改。

### 管理员密码修改

在服务终端中执行：

```text
admin password <新密码>
```

### 删除原始录制文件

管理员需要先完成管理员密码验证，之后才可以通过管理页面执行原片删除。

删除操作会进行以下检查：

1. 原片是否存在。
2. 是否正在录制。
3. 是否正在被切片任务使用。
4. 是否已经有其他删除任务。
5. 是否正在执行转码。

确认允许删除后：

1. 获取原片删除锁。
2. 移除等待中的转码任务。
3. 停止正在执行的转码进程。
4. 等待 FFmpeg 进程退出。
5. 删除对应的 HLS 预览目录。
6. 删除原始录制文件。

这样可以减少原片删除与录制、转码、切片任务之间的竞争问题。

---

## 13. 命令行终端

服务启动后会显示交互式命令行：

```text
XIGEMBiliREC>
```

输入：

```text
help
```

可以查看全部可用命令。

### 13.1 用户管理

添加用户或重置用户密码：

```text
user set <用户名> <密码>
```

示例：

```text
user set test 123456
```

删除用户：

```text
user delete <用户名>
```

查看用户：

```text
user list
```

密码至少需要 6 位。

修改用户密码或删除用户后，程序会注销该用户已有的登录会话。

### 13.2 管理员管理

修改管理员密码：

```text
admin password <新密码>
```

示例：

```text
admin password MyNewPassword123
```

### 13.3 直播间管理

添加直播间：

```text
room add <房间号>
```

示例：

```text
room add 2233
```

删除直播间：

```text
room delete <房间号>
```

启用录制：

```text
room rec <房间号> true
```

关闭录制：

```text
room rec <房间号> false
```

也支持：

```text
room rec <房间号> 1
room rec <房间号> 0
```

查看直播间状态：

```text
room list <房间号>
```

### 13.4 其他命令

查看帮助：

```text
help
```

关闭服务：

```text
exit
```

重置服务端配置：

```text
reinitialize
```

### 13.5 reinitialize 的行为

该命令会删除以下 JSON 配置文件：

```text
config/server.json
config/runtime.json
config/rooms.json
user/sessions.json
user/stats.json
```

随后关闭服务。

下次重新启动时，程序会重新生成缺失的配置文件。

**注意：该命令不会删除原始录制文件、HLS 预览文件、用户切片文件和日志文件。**

---

## 14. HTTP API

以下接口以当前后端路由为准。

如果 `server.basePath` 不为 `/`，则需要在接口路径前增加对应基础路径。

### 14.1 用户认证

| 方法 | 路径 | 功能 |
|---|---|---|
| POST | `/api/login` | 用户登录 |
| POST | `/api/logout` | 用户退出 |
| POST | `/api/admin/login` | 管理员密码验证 |
| GET | `/api/me` | 获取当前登录信息 |
| POST | `/api/password` | 修改用户密码 |

登录请求示例：

```http
POST /api/login
Content-Type: application/json
```

```json
{
  "username": "test",
  "password": "123456"
}
```

### 14.2 原始录制文件

| 方法 | 路径 | 功能 |
|---|---|---|
| GET | `/api/recordings` | 获取原始录制文件列表 |

返回内容包含：

- 直播间 ID。
- 文件 ID。
- 文件名。
- 文件大小。
- 创建时间。
- 当前状态。

文件状态包括：

```text
recording
transcoding
ready
```

### 14.3 HLS 视频流

| 方法 | 路径 | 功能 |
|---|---|---|
| GET | `/stream/:roomId/:fileId/:seg` | 获取 HLS 播放列表或视频分片 |

例如：

```text
/stream/2233/2233_20261121_0/index.m3u8
/stream/2233/2233_20261121_0/seg_00000.ts
```

### 14.4 视频切片

| 方法 | 路径 | 功能 |
|---|---|---|
| POST | `/api/clip` | 提交切片任务 |
| GET | `/api/clip/:taskId/status` | 查询切片任务状态 |

提交切片请求：

```http
POST /api/clip
Content-Type: application/json
```

```json
{
  "roomId": "2233",
  "fileId": "2233_20261121_0",
  "start": "00:10:00",
  "end": "00:15:00"
}
```

任务状态示例：

```json
{
  "ok": true,
  "status": "done",
  "error": null,
  "outName": "20261121_0_001000_001500.mp4"
}
```

### 14.5 用户切片文件

| 方法 | 路径 | 功能 |
|---|---|---|
| GET | `/api/clips/mine` | 获取当前用户切片列表 |
| GET | `/api/clips/download/:userId/:fileName` | 下载切片文件 |
| DELETE | `/api/clips/:fileName` | 删除当前用户的切片文件 |

下载接口使用签名和过期时间参数，不应直接绕过签名验证。

### 14.6 管理员原片管理

| 方法 | 路径 | 功能 |
|---|---|---|
| DELETE | `/api/admin/recordings/:roomId/:fileId` | 删除指定原始录制文件 |

该接口要求：

- 已经登录。
- 已完成管理员密码验证。
- 原片存在。
- 原片没有被录制或切片任务占用。

---

## 15. 文件存储与自动清理

项目主要有三类视频文件。

### 15.1 原始录制文件

保存位置：

```text
user/recordings/
```

这是直播录制的原始视频，也是后续切片的来源。

### 15.2 HLS 预览文件

保存位置：

```text
user/previews/
```

用于 Web 视频预览。

每个原始录制文件对应一个独立的 HLS 目录。

### 15.3 用户切片文件

保存位置：

```text
user/tempvideo/<用户名>/
```

用户生成的 MP4 切片保存在各自的目录中。

### 15.4 自动清理规则

切片清理：

- 超过保留时间的切片会被清理。
- 超过用户文件数量限制时，会优先删除较旧的切片。
- 正在下载的切片不会被清理。

原片清理：

- 超过保留期限的原片会被清理。
- 总容量超过限制时，会从较旧的原片开始清理。
- 正在录制、转码、排队转码或切片的原片不会被自动清理。
- 原片删除成功后，会尝试删除对应的 HLS 预览目录。

注意：自动清理与管理员主动删除是不同的操作入口，但都会影响原始录制文件及对应的预览数据。

---

## 16. 日志与运行状态

日志文件：

```text
user/log/server.log
```

日志包含：

- 服务启动和关闭。
- 直播间开播和下播检测。
- FFmpeg 录制启动和结束。
- 录制异常和重试。
- 转码队列执行情况。
- 转码成功和失败。
- 切片任务执行情况。
- 自动清理记录。
- 管理员删除操作。
- HTTP 服务异常。

日志同时输出到控制台和日志文件。

命令行会使用：

```text
XIGEMBiliREC>
```

作为输入提示符。

服务器异步输出日志时，会处理终端提示符的刷新，避免日志输出与命令输入混在一起。

---

## 17. 服务关闭与重置

### 正常关闭

可以在终端输入：

```text
exit
```

也可以使用：

```text
Ctrl + C
```

程序会执行优雅关闭流程：

1. 标记服务正在关闭。
2. 关闭终端输入。
3. 停止轮询和清理定时器。
4. 使尚未完成的录制启动请求失效。
5. 清空等待执行的转码和切片队列。
6. 停止正在运行的录制进程。
7. 停止正在运行的转码进程。
8. 停止正在运行的切片进程。
9. 等待子进程退出。
10. 关闭 HTTP 服务。
11. 刷新并关闭日志文件。
12. 退出 Node.js 进程。

### 配置重置

```text
reinitialize
```

重置后需要重新启动：

```bash
node server.js
```

注意：重置配置不等于清空所有视频数据。

---

## 18. 常见问题

### 18.1 启动时报错 Cannot find module 'express'

原因：项目依赖未安装。

解决：

```bash
npm install express axios
```

### 18.2 报错 spawn ffmpeg ENOENT

原因：Node.js 无法找到 FFmpeg 可执行程序。

解决：

1. 检查 FFmpeg 是否已经安装。
2. 执行 `ffmpeg -version`。
3. 确认 FFmpeg 已加入系统 PATH。
4. 或者在 `server.json` 中填写 FFmpeg 的完整路径。

例如：

```json
{
  "ffmpeg": {
    "path": "C:/ffmpeg/bin/ffmpeg.exe"
  }
}
```

### 18.3 转码任务没有执行

检查：

- `previewTranscode.enabled` 是否为 `true`。
- FFmpeg 路径是否正确。
- 原始录制文件是否存在。
- 转码队列是否已满。
- 是否存在同一原片的转码任务。
- 是否设置了 `transcodeConflict.policy` 为 `pause`。
- 日志中是否存在 FFmpeg 错误。

### 18.4 录制文件存在，但没有 HLS 预览

检查对应目录：

```text
user/previews/<房间ID>/<文件ID>/
```

确认是否生成：

```text
index.m3u8
```

如果没有，可以查看启动恢复扫描和转码失败日志。

### 18.5 用户无法下载切片

检查：

- 切片任务是否已经完成。
- 切片文件是否还存在。
- 下载链接是否过期。
- 下载签名是否有效。
- 用户并发下载数量是否达到上限。

### 18.6 管理员无法删除原片

检查：

- 是否已经完成管理员密码验证。
- 原片是否正在录制。
- 是否正在被切片任务使用。
- 是否有正在执行的转码任务。
- 对应 FFmpeg 进程是否能够正常退出。
- 是否存在文件权限问题。

### 18.7 配置文件修改后没有生效

当前服务在启动时读取配置文件。

修改 `server.json` 或 `rooms.json` 后，需要根据修改内容重启服务，才能确保相关配置被重新加载。

### 18.8 服务关闭时 FFmpeg 没有及时退出

检查 FFmpeg 进程是否仍在运行，以及终端中是否出现子进程退出超时日志。

Windows 环境下，必要时需要检查是否存在未随 Node.js 子进程退出的外部进程。

---

## 19. 开发者须知

### 19.1 项目架构

当前后端采用单文件架构：

```text
server.js
```

主要模块划分：

| 模块 | 主要职责 |
|---|---|
| 工具函数 | 时间处理、路径检查、文件扫描 |
| 日志模块 | 控制台与日志文件输出 |
| 配置模块 | 初始化、读取、验证、保存配置 |
| Session 模块 | 用户登录状态管理 |
| Bilibili API | 获取直播间信息和直播流地址 |
| 录制模块 | 录制进程管理、轮询和异常重试 |
| 转码模块 | 转码队列、HLS 生成、任务恢复 |
| 切片模块 | 切片队列、FFmpeg 执行、状态管理 |
| 清理模块 | 切片和原始录制文件清理 |
| Express 模块 | Web 页面和 HTTP API |
| 终端模块 | 命令行管理 |
| 生命周期模块 | 启动、优雅关闭和子进程管理 |

### 19.2 修改代码时的注意事项

**不要随意修改已有文件命名规则。**

录制文件、HLS 目录和切片文件之间存在对应关系。

**不要绕过任务队列。**

转码和切片任务需要正确维护状态，避免重复执行。

**不要在任务仍运行时删除源文件。**

删除原片前需要检查录制进程、转码任务和切片任务。

**不要随意修改 FFmpeg 参数。**

录制、转码和切片使用不同的 FFmpeg 参数，修改时需要分别验证。

**不要随意修改配置字段名称。**

`server.json` 中的字段由后端直接读取，修改字段名称时需要同步修改相关代码和示例配置。

**注意异步操作和进程生命周期。**

涉及 `spawn()`、Promise、定时器和文件删除的代码，需要考虑服务关闭、任务取消和并发执行的情况。

**保持代码缩进一致。**

修改代码时，应保留所在模块和函数的缩进层级，不要将嵌套代码错误地移动到外层。

### 19.3 修改后检查

每次修改后，建议先运行：

```bash
node --check server.js
```

检查 JavaScript 语法。

然后启动服务：

```bash
node server.js
```

建议至少验证：

- 服务正常启动。
- 用户可以登录和退出。
- 直播间可以添加和启用。
- 直播开播后可以正常录制。
- 录制结束后可以正常转码。
- HLS 预览可以正常播放。
- 用户可以提交和下载切片。
- 管理员可以正常管理用户和删除原片。
- 自动清理不会误删正在使用的文件。
- `exit` 和 `Ctrl + C` 可以正常关闭服务。

---

## 许可证

请根据项目实际采用的许可证补充相关信息。

如项目依赖或使用第三方代码，也应遵守对应项目的许可证和使用条款。

---

**XIGEMBiliREC**

Bilibili Live Recording & Clipping Backend