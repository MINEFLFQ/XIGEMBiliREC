// ============================================================
// XIGEMBiliREC Beta_0.2.1
// 依赖：express, axios
// 启动：node server.js
// ============================================================

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const readline = require('readline');

// ---------- 路径常量 ----------
const ROOT = __dirname;
const CONFIG_DIR = path.join(ROOT, 'config');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PUBLIC_STATIC_DIR = path.join(ROOT, 'public-static');
const USER_DIR = path.join(ROOT, 'user');
const SERVER_CFG = path.join(CONFIG_DIR, 'server.json');
const SERVER_CFG_EXAMPLE = path.join(CONFIG_DIR, 'server.example.json');
const RUNTIME_CFG = path.join(CONFIG_DIR, 'runtime.json');
const ROOMS_CFG = path.join(CONFIG_DIR, 'rooms.json');
const LOG_DIR = path.join(USER_DIR, 'log');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const SESSION_FILE = path.join(USER_DIR, 'sessions.json');
const STATS_FILE = path.join(USER_DIR, 'stats.json');

const KNOWN_RECORD_EXTS = ['mkv', 'mp4', 'flv', 'ts'];

// ---------- 工具 ----------
const pad2 = n => String(n).padStart(2, '0');
const stampDate = d => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;

// 最大允许切片时间：7 天
const MAX_CLIP_SECONDS = 7 * 24 * 60 * 60;

const toHMS = sec => `${pad2(Math.floor(sec / 3600))}${pad2(Math.floor((sec % 3600) / 60))}${pad2(Math.floor(sec % 60))}`;

function parseHMS(value) {
  const s = String(value ?? '').trim();

  let seconds = null;
  let m = null;

  // HH:MM:SS，小时支持 1～3 位
  m = s.match(/^(\d{1,3}):(\d{2}):(\d{2})$/);

  if (m) {
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    const ss = Number(m[3]);

    if (mm >= 60 || ss >= 60) {
      return null;
    }

    seconds = hh * 3600 + mm * 60 + ss;

  } else {
    // MM:SS
    m = s.match(/^(\d{1,2}):(\d{2})$/);

    if (m) {
      const mm = Number(m[1]);
      const ss = Number(m[2]);

      if (mm >= 60 || ss >= 60) {
        return null;
      }

      seconds = mm * 60 + ss;

    } else if (/^\d+$/.test(s)) {
      const raw = s;

      // 纯秒数
      if (raw.length <= 2) {
        seconds = Number(raw);

      // MMSS 或 HHMMSS
      } else if (raw.length >= 3 && raw.length <= 7) {
        let hh = 0;
        let mm = 0;
        let ss = 0;

        if (raw.length <= 4) {
          mm = Number(raw.slice(0, -2));
          ss = Number(raw.slice(-2));
        } else {
          hh = Number(raw.slice(0, -4));
          mm = Number(raw.slice(-4, -2));
          ss = Number(raw.slice(-2));
        }

        if (mm >= 60 || ss >= 60) {
          return null;
        }

        seconds = hh * 3600 + mm * 60 + ss;
      }
    }
  }

  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 0
  ) {
    return null;
  }

  return seconds;
}

const safeName = s => typeof s === 'string' && /^[a-zA-Z0-9_-]+$/.test(s);
const isClipFileName = f => /^\d{8}_\d+_\d{6,7}_\d{6,7}\.mp4$/.test(f);
const ensureDir = d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
};

function normalizeBasePath(p) {
  if (p === undefined || p === null || p === '') return '/';

  let s = String(p).trim();

  if (s === '' || s === '/') return '/';
  if (!s.startsWith('/')) s = '/' + s;
  if (!s.endsWith('/')) s = s + '/';

  return s;
}

// 判断目标路径是否处于指定目录内部
function isPathInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(base, target);

  return relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

// 扫描目录下所有已知扩展名的录制文件
async function listRecordingFiles(roomDir) {
  const files = await fsp.readdir(roomDir).catch(() => []);
  const out = [];

  for (const f of files) {
    const dot = f.lastIndexOf('.');
    if (dot <= 0) continue;

    const ext = f.slice(dot + 1).toLowerCase();
    if (!KNOWN_RECORD_EXTS.includes(ext)) continue;

    const fileId = f.slice(0, dot);
    out.push({ fileName: f, fileId, ext });
  }

  return out;
}

function findRecordingFile(roomDir, fileId) {
  for (const ext of KNOWN_RECORD_EXTS) {
    const fp = path.join(roomDir, `${fileId}.${ext}`);

    if (fs.existsSync(fp)) {
      return { fp, ext };
    }
  }

  return null;
}

// ---------- 日志 ----------
let logStream = null;
let logStreamErrored = false;

function initLog() {
  ensureDir(LOG_DIR);

  logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

  logStream.on('error', e => {
    if (!logStreamErrored) {
      logStreamErrored = true;
      console.error(`[log] 写入失败，后续日志仅输出到控制台：${e.message}`);
    }
  });
}

function log(level, ...args) {
  const line = `[${new Date().toISOString()}] [${level}] ${args.join(' ')}`;

  terminalPrint(line);

  if (logStream) {
    try {
      logStream.write(line + '\n');
    } catch (e) {}
  }
}

function closeLog() {
  return new Promise(resolve => {
    if (!logStream) return resolve();
    logStream.end(() => resolve());
  });
}

// ---------- 密码 ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');

  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const test = crypto.scryptSync(password, salt, 64).toString('hex');

    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(test, 'hex')
    );
  } catch (e) {
    return false;
  }
}

function safeEqualHex(a, b) {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');

    if (ba.length !== bb.length) return false;

    return crypto.timingSafeEqual(ba, bb);
  } catch (e) {
    return false;
  }
}

function signDownload(userId, fileName, expires, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${userId}:${fileName}:${expires}`)
    .digest('hex');
}

// ---------- 默认配置 ----------
const DEFAULT_SERVER_CONFIG = {
  server: {
    port: 3001,
    host: '127.0.0.1',
    basePath: '/'
  },

  paths: {
    recordings: './user/recordings',
    previews: './user/previews',
    tempvideo: './user/tempvideo'
  },

  ffmpeg: {
    path: 'ffmpeg'
  },

  recorder: {
    outputFormat: 'mkv',
    pollInterval: 60000,
    pollJitter: 15000,
    retryInterval: 300000,
    retryMax: 5,

    headers: {
      Referer: 'https://live.bilibili.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  },

  previewTranscode: {
    enabled: true,
    scale: '640:360',
    fps: 15,
    videoBitrate: '300k',
    maxrate: '350k',
    bufsize: '600k',
    preset: 'veryslow',
    profile: 'high',
    audioBitrate: '48k',
    audioSampleRate: 44100,
    hlsSegmentTime: 6,
    maxAttempts: 2,
    recoverIntervalMinutes: 60
  },

  transcodeConflict: {
    policy: 'slowdown',
    slowdown: {
      threads: 2
    },
    pause: {
      requeueDelaySeconds: 300
    }
  },

  clip: {
    maxFiles: 5,
    maxHardLimit: 10,
    retentionHours: 6,
    cleanupIntervalMinutes: 5,
    dailyLimit: 10,
    maxConcurrent: 1,
    maxConcurrentDownloads: 3,

    // 最多等待执行的切片任务数量
    maxQueue: 100,

    // 最多保留的切片任务记录数量
    maxTaskHistory: 500,

    // 已完成或失败的任务记录保留时间
    taskRetentionHours: 24
  },

  storage: {
    rawRetention: {
      maxAgeDays: 30,
      maxTotalGB: 2000,
      checkIntervalHours: 6
    }
  }
};

const DEFAULT_ROOMS_CONFIG = {
  rooms: [
    {
      id: 'demo',
      roomId: 2233,
      name: '示例房间',
      quality: 10000,
      enabled: false
    }
  ]
};

// ---------- 配置初始化 ----------
function initConfigs() {
  ensureDir(CONFIG_DIR);
  ensureDir(USER_DIR);
  ensureDir(LOG_DIR);

  ensureDir(path.join(USER_DIR, 'recordings'));
  ensureDir(path.join(USER_DIR, 'previews'));
  ensureDir(path.join(USER_DIR, 'tempvideo'));

  ensureDir(PUBLIC_DIR);
  ensureDir(PUBLIC_STATIC_DIR);

  if (!fs.existsSync(SERVER_CFG)) {
    if (fs.existsSync(SERVER_CFG_EXAMPLE)) {
      fs.copyFileSync(SERVER_CFG_EXAMPLE, SERVER_CFG);
      log('INFO', '已从 server.example.json 生成 server.json');
    } else {
      fs.writeFileSync(
        SERVER_CFG,
        JSON.stringify(DEFAULT_SERVER_CONFIG, null, 2)
      );

      log('INFO', '已生成默认 server.json');
    }
  }

  if (!fs.existsSync(RUNTIME_CFG)) {
    const runtime = {
      downloadSecret: crypto.randomBytes(32).toString('hex'),
      users: [],
      admin: {
        passwordHash: hashPassword('XIGEMBiliREC')
      }
    };

    fs.writeFileSync(
      RUNTIME_CFG,
      JSON.stringify(runtime, null, 2)
    );

    log('INFO', '已生成 runtime.json');
    log('INFO', '管理员默认密码：XIGEMBiliREC');

    console.log('');
    console.log('========================================');
    console.log('  首次启动安全提醒');
    console.log('========================================');
    console.log('管理员默认密码：XIGEMBiliREC');
    console.log('请使用以下命令修改管理员密码：');
    console.log('admin password <新密码>');
    console.log('可以暂时不修改，不影响服务启动。');
    console.log('========================================');
    console.log('');
  }

  if (!fs.existsSync(ROOMS_CFG)) {
    fs.writeFileSync(
      ROOMS_CFG,
      JSON.stringify(DEFAULT_ROOMS_CONFIG, null, 2)
    );

    log('INFO', '已生成默认 rooms.json（含示例房间 2233，默认禁用）');
  }

  if (!fs.existsSync(SESSION_FILE)) {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({}, null, 2));
    log('INFO', '已生成 sessions.json');
  }

  if (!fs.existsSync(STATS_FILE)) {
    fs.writeFileSync(STATS_FILE, JSON.stringify({}, null, 2));
    log('INFO', '已生成 stats.json');
  }
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateConfig(cfg) {
  const errs = [];

  if (!cfg.server?.port) errs.push('server.port');
  if (!cfg.paths?.recordings) errs.push('paths.recordings');
  if (!cfg.paths?.previews) errs.push('paths.previews');
  if (!cfg.paths?.tempvideo) errs.push('paths.tempvideo');
  if (!cfg.ffmpeg?.path) errs.push('ffmpeg.path');
  if (!cfg.recorder?.pollInterval) errs.push('recorder.pollInterval');
  if (!cfg.recorder?.outputFormat) errs.push('recorder.outputFormat');
  if (!cfg.clip?.maxFiles) errs.push('clip.maxFiles');
  if (!cfg.clip?.maxHardLimit) errs.push('clip.maxHardLimit');

  const pt = cfg.previewTranscode;

  if (pt?.enabled) {
    for (const k of [
      'scale',
      'fps',
      'videoBitrate',
      'maxrate',
      'bufsize',
      'preset',
      'profile',
      'audioBitrate',
      'audioSampleRate'
    ]) {
      if (pt[k] === undefined || pt[k] === null || pt[k] === '') {
        errs.push(`previewTranscode.${k}`);
      }
    }
  }

  if (errs.length) {
    log('ERROR', `配置校验失败，缺少：${errs.join(', ')}`);
    process.exit(1);
  }

  if (cfg.ffmpeg.path !== 'ffmpeg' && !fs.existsSync(cfg.ffmpeg.path)) {
    log('ERROR', `ffmpeg 路径不存在：${cfg.ffmpeg.path}`);
    process.exit(1);
  }
}

function loadRuntime() {
  return JSON.parse(fs.readFileSync(RUNTIME_CFG, 'utf8'));
}

// 原子写入 runtime.json，避免写入过程中中断导致文件损坏
function saveRuntime(d) {
  const tmp = RUNTIME_CFG + '.tmp';

  try {
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, RUNTIME_CFG);
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (e2) {}

    throw e;
  }
}

// ---------- Session ----------
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const ADMIN_TTL_MS = 30 * 60 * 1000;

let sessions = (() => {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
})();

function saveSessions() {
  const tmp = SESSION_FILE + '.tmp';

  try {
    fs.writeFileSync(tmp, JSON.stringify(sessions, null, 2));
    fs.renameSync(tmp, SESSION_FILE);
  } catch (e) {
    log('ERROR', `sessions 保存失败 ${e.message}`);

    try {
      fs.unlinkSync(tmp);
    } catch (e2) {}
  }
}

function createSession(username, role, adminAuthenticated = false) {
  const sid = crypto.randomBytes(32).toString('hex');

  sessions[sid] = {
    username,
    role,
    adminAuthenticated,
    adminAuthenticatedAt: adminAuthenticated ? Date.now() : null,
    createdAt: Date.now()
  };

  saveSessions();

  return sid;
}

function getSession(sid) {
  const s = sessions[sid];

  if (!s) return null;

  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    delete sessions[sid];
    saveSessions();
    return null;
  }

  if (
    s.adminAuthenticated &&
    s.adminAuthenticatedAt &&
    Date.now() - s.adminAuthenticatedAt > ADMIN_TTL_MS
  ) {
    s.adminAuthenticated = false;
    s.adminAuthenticatedAt = null;
    saveSessions();
  }

  return s;
}

function destroySession(sid) {
  delete sessions[sid];
  saveSessions();
}

function getSessionFromReq(req) {
  const sid = req.cookies?.sid;
  return sid ? getSession(sid) : null;
}

// ---------- Cookie 解析 ----------
function cookieParser() {
  return (req, res, next) => {
    req.cookies = {};

    const raw = req.headers.cookie;

    if (raw) {
      raw.split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx < 0) return;

        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();

        try {
          req.cookies[k] = decodeURIComponent(v);
        } catch (e) {
          req.cookies[k] = v;
        }
      });
    }

    next();
  };
}

// ---------- B 站接口 ----------
async function biliRoomInfo(roomId, headers) {
  const res = await axios.get(
    `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`,
    { headers, timeout: 10000 }
  );

  return res.data.data;
}


// 获取 B 站主播昵称
async function biliAnchorNick(uid, headers) {
  if (!uid) {
    throw new Error('无法获取主播 UID');
  }

  const res = await axios.get(
    `https://api.live.bilibili.com/live_user/v1/Master/info?uid=${uid}`,
    { headers, timeout: 10000 }
  );

  const nick = res.data?.data?.info?.uname;

  if (!nick) {
    throw new Error(
      res.data?.message || res.data?.msg || '无法获取主播昵称'
    );
  }

  return String(nick).trim();
}


// ---------- 主播昵称定期更新 ----------

let nickRefreshRunning = false;

// 更新所有直播间的主播昵称
async function refreshRoomNicknames(serverCfg, roomsData) {
  if (nickRefreshRunning || isShuttingDown) return;

  nickRefreshRunning = true;

  let changed = false;

  try {
    for (let i = 0; i < roomsData.rooms.length; i++) {
      if (isShuttingDown) break;

      const room = roomsData.rooms[i];

      try {
        // 获取直播间 UID
        const info = await biliRoomInfo(
          room.roomId,
          serverCfg.recorder.headers
        );

        // 获取主播昵称
        const nick = await biliAnchorNick(
          info.uid,
          serverCfg.recorder.headers
        );

        if (nick && nick !== room.nick) {
          log(
            'INFO',
            `[${room.roomId}] 主播昵称更新：${room.nick || '未设置'} -> ${nick}`
          );

          room.nick = nick;
          changed = true;
        }

      } catch (e) {
        log(
          'WARN',
          `[${room.roomId}] 更新主播昵称失败：${e.message}`
        );
      }

      // 请求之间稍作间隔，避免连续请求过于密集
      if (i < roomsData.rooms.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // 只有发生变化才写入 rooms.json
    if (changed) {
      saveRooms(roomsData);
      log('INFO', '直播间主播昵称已更新并保存');
    }

  } finally {
    nickRefreshRunning = false;
  }
}

async function biliStreamUrl(roomId, qn, headers) {
  const res = await axios.get(
    `https://api.live.bilibili.com/room/v1/Room/playUrl?cid=${roomId}&qn=${qn}&platform=web`,
    { headers, timeout: 10000 }
  );

  const durl = res.data.data.durl;

  if (!durl || !durl.length) {
    throw new Error('无可用流地址');
  }

  return durl[0].url;
}

// ---------- 录制 ----------
const roomStates = new Map();
const recordingProcs = new Map();
const crashCounters = new Map();
const retryTokens = new Map();

// 录制启动令牌，防止异步获取直播地址期间被关闭后又启动
const recordingStartTokens = new Map();

async function pickNextFileName(room, recDir, serverCfg) {
  const roomDir = path.join(recDir, room.id);
  ensureDir(roomDir);

  const today = stampDate(new Date());
  const ext = serverCfg.recorder.outputFormat || 'mkv';
  const prefix = `${room.id}_${today}_`;

  let maxIdx = -1;

  try {
    const files = await fsp.readdir(roomDir);

    for (const f of files) {
      const dot = f.lastIndexOf('.');
      if (dot <= 0) continue;
      if (!f.startsWith(prefix)) continue;

      const n = Number(f.slice(prefix.length, dot));

      if (Number.isInteger(n) && n > maxIdx) {
        maxIdx = n;
      }
    }
  } catch (e) {}

  return {
    fileName: `${prefix}${maxIdx + 1}.${ext}`
  };
}

function scheduleRetry(roomId, crashes, serverCfg) {
  const token = (retryTokens.get(roomId) || 0) + 1;
  retryTokens.set(roomId, token);

  const retryInterval = serverCfg.recorder.retryInterval || 300000;
  const retryMax = serverCfg.recorder.retryMax || 5;

  if (crashes > retryMax) {
    roomStates.set(roomId, 'cooling');

    const cooldown = retryInterval * retryMax;

    log(
      'ERROR',
      `[${roomId}] 连续失败 ${crashes} 次，超过上限 ${retryMax}，进入冷却 ${Math.round(cooldown / 60000)} 分钟`
    );

    const timer = setTimeout(() => {
      if (retryTokens.get(roomId) !== token) return;

      if (roomStates.get(roomId) === 'cooling') {
        crashCounters.set(roomId, 0);
        roomStates.set(roomId, 'idle');

        log('INFO', `[${roomId}] 冷却结束，恢复轮询`);
      }
    }, cooldown);

    if (timer.unref) timer.unref();
    return;
  }

  const delay = Math.min(
    retryInterval * Math.pow(2, Math.max(0, crashes - 1)),
    30 * 60 * 1000
  );

  roomStates.set(roomId, 'waiting_retry');

  log(
    'WARN',
    `[${roomId}] 将在 ${Math.round(delay / 1000)}s 后重试（连续失败 ${crashes}/${retryMax} 次）`
  );

  const timer = setTimeout(() => {
    if (retryTokens.get(roomId) !== token) return;

    if (roomStates.get(roomId) === 'waiting_retry') {
      roomStates.set(roomId, 'idle');
    }
  }, delay);

  if (timer.unref) timer.unref();
}


async function startRecording(room, serverCfg) {
  // 防止重复启动
  if (
    recordingProcs.has(room.id) ||
    roomStates.get(room.id) === 'starting' ||
    roomStates.get(room.id) === 'recording'
  ) {
    log('WARN', `[${room.id}] 已有录制任务或正在启动，跳过重复启动`);
    return;
  }

  if (!room.enabled || isShuttingDown) {
    return;
  }

  // 创建本次启动令牌
  const startToken =
    (recordingStartTokens.get(room.id) || 0) + 1;

  recordingStartTokens.set(room.id, startToken);
  roomStates.set(room.id, 'starting');

  try {
    const recDir = path.resolve(
      ROOT,
      serverCfg.paths.recordings
    );

    const { fileName } = await pickNextFileName(
      room,
      recDir,
      serverCfg
    );

    const outFile = path.join(
      recDir,
      room.id,
      fileName
    );

    const streamUrl = await biliStreamUrl(
      room.roomId,
      room.quality,
      serverCfg.recorder.headers
    );

    // 异步请求结束后，重新确认是否仍允许启动
    if (
      recordingStartTokens.get(room.id) !== startToken ||
      !room.enabled ||
      isShuttingDown
    ) {
      log('INFO', `[${room.id}] 录制启动已取消`);
      return;
    }

    const hdrs =
      `Referer: ${serverCfg.recorder.headers.Referer}\r\n` +
      `User-Agent: ${serverCfg.recorder.headers['User-Agent']}\r\n`;

    const proc = spawn(
      serverCfg.ffmpeg.path,
      [
        '-headers',
        hdrs,
        '-i',
        streamUrl,
        '-c',
        'copy',
        '-y',
        outFile
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'pipe']
      }
    );

    const info = {
      proc,
      fileName,
      outFile,
      startTime: Date.now(),
      room
    };

    recordingProcs.set(room.id, info);
    roomStates.set(room.id, 'recording');
    crashCounters.set(room.id, 0);

    proc.on('close', code => {
      log(
        'INFO',
        `[${room.id}] 录制结束，退出码 ${code}，文件 ${fileName}`
      );

      const cur = recordingProcs.get(room.id);

      if (cur && cur.proc === proc) {
        recordingProcs.delete(room.id);
      }

      let size = 0;

      try {
        size = fs.statSync(outFile).size;
      } catch (e) {}

      if (size < 1024 * 1024) {
        try {
          fs.unlinkSync(outFile);
        } catch (e) {}
      }

      const crashed =
        code !== 0 &&
        roomStates.get(room.id) === 'recording';

      if (crashed) {
        const crashes =
          (crashCounters.get(room.id) || 0) + 1;

        crashCounters.set(room.id, crashes);
        scheduleRetry(room.id, crashes, serverCfg);

      } else if (size > 1024 * 1024) {
        crashCounters.set(room.id, 0);

        triggerTranscode(
          room.id,
          outFile,
          serverCfg
        );
      }

      if (roomStates.get(room.id) === 'recording') {
        roomStates.set(room.id, 'idle');
      }
    });

    proc.on('error', e => {
      log(
        'ERROR',
        `[${room.id}] 录制进程错误：${e.message}`
      );
    });

    log('INFO', `[${room.id}] 开始录制 -> ${fileName}`);

  } catch (e) {
    // 已取消的启动请求不再触发重试
    if (
      recordingStartTokens.get(room.id) !== startToken ||
      !room.enabled ||
      isShuttingDown
    ) {
      return;
    }

    if (!recordingProcs.has(room.id)) {
      roomStates.set(room.id, 'idle');
    }

    log(
      'ERROR',
      `[${room.id}] 录制启动失败：${e.message}`
    );

    const crashes =
      (crashCounters.get(room.id) || 0) + 1;

    crashCounters.set(room.id, crashes);

    scheduleRetry(
      room.id,
      crashes,
      serverCfg
    );
  }
}


function stopRecording(roomId) {
  // 使尚未完成的启动请求失效
  recordingStartTokens.set(
    roomId,
    (recordingStartTokens.get(roomId) || 0) + 1
  );

  const rec = recordingProcs.get(roomId);

  if (!rec) {
    roomStates.set(roomId, 'idle');
    return false;
  }

  try {
    if (process.platform === 'win32' && rec.proc.stdin) {
      rec.proc.stdin.write('q');
    } else {
      rec.proc.kill('SIGINT');
    }
  } catch (e) {}

  roomStates.set(roomId, 'idle');

  return true;
}

// ---------- 轮询 ----------
let pollTimer = null;

async function pollLoop(serverCfg, roomsData) {
  const base = serverCfg.recorder.pollInterval || 60000;
  const jitter = serverCfg.recorder.pollJitter || 15000;
  const nextDelay = base + Math.floor(Math.random() * jitter);

  for (const room of roomsData.rooms) {
    if (!room.enabled) continue;

    const state = roomStates.get(room.id) || 'idle';

    if (state === 'recording') {
      try {
        const info = await biliRoomInfo(
          room.roomId,
          serverCfg.recorder.headers
        );

        if (info.live_status !== 1) {
          log('INFO', `[${room.id}] 检测到下播`);
          stopRecording(room.id);
        }
      } catch (e) {
        log('WARN', `[${room.id}] 下播检测失败 ${e.message}`);
      }
    } else if (state === 'idle') {
      try {
        const info = await biliRoomInfo(
          room.roomId,
          serverCfg.recorder.headers
        );

        if (info.live_status === 1) {
          await startRecording(room, serverCfg);
        }
      } catch (e) {
        log('WARN', `[${room.id}] 开播检测失败 ${e.message}`);
      }
    }
  }

  pollTimer = setTimeout(
    () => pollLoop(serverCfg, roomsData),
    nextDelay
  );
}

// ---------- 转码 ----------
const MAX_TRANSCODE_QUEUE = 100;
const transcodeQueue = [];

let transcodeRunning = false;
let transcodeWakeupTimer = null;

// 记录正在转码的源文件
const transcodingFiles = new Set();

// 记录正在运行的 FFmpeg 转码进程
// key：原始录制文件的绝对路径
// value：FFmpeg ChildProcess
const transcodeProcesses = new Map();

// 记录 FFmpeg 进程的退出 Promise
// 用于确保取消转码时，真正等待进程退出
const transcodeClosePromises = new Map();

// 记录被管理员主动取消的转码任务
const cancelledTranscodes = new Set();

// 正在执行删除操作的原始录制文件
// 防止删除原片期间又有新的切片任务进入
const deletingRecordingFiles = new Set();

function triggerTranscode(roomId, srcFile, serverCfg) {
  if (!serverCfg.previewTranscode?.enabled) return;

  const added = addTranscodeJob({
    roomId,
    srcFile,
    serverCfg,
    notBefore: 0,
    attempts: 0
  });

  if (!added) {
    log(
      'INFO',
      `[${roomId}] 转码任务已存在或无法入队，跳过 ${srcFile}`
    );

    return;
  }

  runTranscodeQueue();
}

function enqueueRecovered(roomId, srcFile, serverCfg) {
  return addTranscodeJob({
    roomId,
    srcFile,
    serverCfg,
    notBefore: 0,
    attempts: 0,
    fromRecover: true
  });
}

function requeueWithDelay(
  roomId,
  srcFile,
  serverCfg,
  delayMs,
  attempts
) {
  const added = addTranscodeJob({
    roomId,
    srcFile,
    serverCfg,
    notBefore: Date.now() + delayMs,
    attempts
  });

  if (added) {
    scheduleTranscodeWakeup();
  }

  return added;
}

function scheduleTranscodeWakeup() {
  if (transcodeWakeupTimer) {
    clearTimeout(transcodeWakeupTimer);
    transcodeWakeupTimer = null;
  }

  const now = Date.now();
  let next = Infinity;

  for (const job of transcodeQueue) {
    if (job.notBefore && job.notBefore < next) {
      next = job.notBefore;
    }
  }

  if (next === Infinity) {
    if (transcodeQueue.length) {
      runTranscodeQueue();
    }

    return;
  }

  const delay = Math.max(
    0,
    Math.min(next - now, 60 * 1000)
  );

  transcodeWakeupTimer = setTimeout(() => {
    transcodeWakeupTimer = null;
    runTranscodeQueue();
  }, delay);

  if (transcodeWakeupTimer.unref) {
    transcodeWakeupTimer.unref();
  }
}

// 检查原片是否已经存在于转码等待队列
function isTranscodeQueued(srcFile) {
  const target = path.resolve(srcFile);

  return transcodeQueue.some(job => {
    return (
      job.srcFile &&
      path.resolve(job.srcFile) === target
    );
  });
}

// 统一添加转码任务，防止重复和队列无限增长
function addTranscodeJob(job) {
  if (isShuttingDown || !job.srcFile) {
    return false;
  }

  const target = path.resolve(job.srcFile);

  if (isTranscodeActiveOrQueued(target)) {
    return false;
  }

  if (transcodeQueue.length >= MAX_TRANSCODE_QUEUE) {
    log(
      'WARN',
      `转码队列已满，无法添加任务：${target}`
    );

    return false;
  }

  transcodeQueue.push({
    ...job,
    srcFile: target
  });

  return true;
}

// 检查原片是否已经排队或正在转码
function isTranscodeActiveOrQueued(srcFile) {
  const target = path.resolve(srcFile);

  return (
    isTranscodeQueued(target) ||
    transcodingFiles.has(target) ||
    transcodeProcesses.has(target)
  );
}

// 检查原片是否正在被切片任务使用
function isClipUsingSource(srcFile) {
  const target = path.resolve(srcFile);

  for (const task of clipTasks.values()) {
    if (
      (task.status === 'queued' || task.status === 'running') &&
      task.srcFile &&
      path.resolve(task.srcFile) === target
    ) {
      return true;
    }
  }

  return false;
}

// 取消指定原始文件的转码任务

async function cancelTranscodeForFile(srcFile) {
  const target = path.resolve(srcFile);

  // 1. 从等待队列中移除对应任务
  for (let i = transcodeQueue.length - 1; i >= 0; i--) {
    if (path.resolve(transcodeQueue[i].srcFile) === target) {
      transcodeQueue.splice(i, 1);
    }
  }

  // 重新计算队列唤醒时间
  scheduleTranscodeWakeup();

  // 2. 检查是否正在运行 FFmpeg
  const proc = transcodeProcesses.get(target);

  if (!proc) {
    // 正常情况下，正在转码就应该已经登记进程
    // 如果状态不一致，不允许继续删除原片
    if (transcodingFiles.has(target)) {
      throw new Error('转码任务正在启动，但 FFmpeg 进程尚未登记');
    }

    return;
  }

  const closePromise = transcodeClosePromises.get(target);

  if (!closePromise) {
    throw new Error('无法获取 FFmpeg 进程退出状态，取消操作中止');
  }

  // 3. 标记为管理员主动取消
  cancelledTranscodes.add(target);

  log(
    'INFO',
    `[transcode] 管理员请求停止转码：${target}`
  );

  // 4. 等待进程退出，先尝试正常终止
  if (proc.exitCode === null && proc.signalCode === null) {
    try {
      proc.kill();
    } catch (e) {
      log(
        'WARN',
        `[transcode] 发送停止指令失败：${e.message}`
      );
    }
  }

  // 等待指定时间
  const waitForClose = async timeoutMs => {
    let timer = null;

    try {
      return await Promise.race([
        closePromise,
        new Promise(resolve => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // 最多等待 10 秒
  let result = await waitForClose(10000);

  // 5. 超时后强制终止
  if (!result) {
    log(
      'WARN',
      `[transcode] FFmpeg 10 秒内未退出，尝试强制终止：${target}`
    );

    try {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill('SIGKILL');
      }
    } catch (e) {
      log(
        'ERROR',
        `[transcode] 强制终止 FFmpeg 失败：${e.message}`
      );
    }

    // 再等待 5 秒
    result = await waitForClose(5000);
  }

  // 6. 进程仍未退出，禁止删除原片
  if (!result) {
    throw new Error('FFmpeg 进程无法正常退出，已取消删除操作');
  }

  log(
    'INFO',
    `[transcode] FFmpeg 已完全退出：${target}`
  );
}

// 删除原始录制文件对应的 HLS 预览目录
async function removePreviewDirectory(roomId, fileId, serverCfg) {
  const previewBase = path.resolve(
    ROOT,
    serverCfg.paths.previews
  );

  const prevDir = path.resolve(
    previewBase,
    roomId,
    fileId
  );

  if (!isPathInside(previewBase, prevDir)) {
    throw new Error('预览目录路径非法');
  }

  await fsp.rm(prevDir, {
    recursive: true,
    force: true
  });
}

async function runTranscodeQueue() {
  if (transcodeRunning) return;

  transcodeRunning = true;

  try {
    while (!isShuttingDown && transcodeQueue.length) {
      const now = Date.now();
      let idx = -1;

      for (let i = 0; i < transcodeQueue.length; i++) {
        if (
          !transcodeQueue[i].notBefore ||
          transcodeQueue[i].notBefore <= now
        ) {
          idx = i;
          break;
        }
      }

      if (idx === -1) break;

      const job = transcodeQueue.splice(idx, 1)[0];

      try {
        await doTranscode(job);
      } catch (e) {
        if (
          e &&
          (
            e.code === 'PAUSE_DEFERRED'||
            e.code === 'TRANSCODE_CANCELLED'
          )
        ) {
          // 暂停任务或管理员主动取消，不进入失败重试
        } else {
          const attempts = (job.attempts || 0) + 1;

          // 从当前转码任务中读取配置
          const configuredMaxAttempts = Number(
            job.serverCfg?.previewTranscode?.maxAttempts
          );

          const maxAttempts =
            Number.isInteger(configuredMaxAttempts) && configuredMaxAttempts > 0
              ? configuredMaxAttempts
              : 2;

          if (attempts < maxAttempts) {
            const delay = 10 * 60 * 1000;

            log(
              'WARN',
              `[${job.roomId}] 转码失败（${attempts}/${maxAttempts}），${Math.round(delay / 60000)} 分钟后重试：${e.message}`
            );

            requeueWithDelay(
              job.roomId,
              job.srcFile,
              job.serverCfg,
              delay,
              attempts
            );
          } else {
            log(
              'ERROR',
              `[${job.roomId}] 转码失败，已达最大重试次数：${e.message}`
            );
          }
        }
      }
    }
  } finally {
    transcodeRunning = false;

    if (transcodeQueue.length) {
      scheduleTranscodeWakeup();
    }
  }
}

// 检查 HLS 转码产物是否完整
async function validateHlsOutput(prevDir, m3u8) {
  const content = await fsp.readFile(m3u8, 'utf8');

  if (!content.includes('#EXTM3U')) {
    throw new Error('HLS 播放列表不存在或格式错误');
  }

  // 必须包含结束标记，确认播放列表已经写入完成
  if (!content.includes('#EXT-X-ENDLIST')) {
    throw new Error('HLS 播放列表尚未完成');
  }

  // 提取播放列表中引用的 TS 文件
  const segments = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  if (!segments.length) {
    throw new Error('HLS 播放列表中没有 TS 分片');
  }

  for (const segment of segments) {
    // 只允许当前预览目录内的 TS 文件
    if (
      path.basename(segment) !== segment ||
      !/\.ts$/i.test(segment)
    ) {
      throw new Error(`HLS 分片路径非法：${segment}`);
    }

    const segmentFile = path.resolve(prevDir, segment);

    if (!isPathInside(prevDir, segmentFile)) {
      throw new Error(`HLS 分片路径越界：${segment}`);
    }

    const st = await fsp.stat(segmentFile).catch(() => null);

    if (!st || !st.isFile() || st.size <= 0) {
      throw new Error(`HLS TS 分片不存在或为空：${segment}`);
    }
  }

  return segments.length;
}

async function doTranscode({ roomId, srcFile, serverCfg }) {
  const activeRec = recordingProcs.get(roomId);

  if (activeRec && activeRec.outFile === srcFile) {
    log('WARN', `[${roomId}] 跳过正在录制的文件转码 ${srcFile}`);
    return;
  }

  const t = serverCfg.previewTranscode;
  const conflict = serverCfg.transcodeConflict || {};
  const anyRecording = [...roomStates.values()].includes('recording');

  if (anyRecording && conflict.policy === 'pause') {
    const delaySec =
      conflict.pause?.requeueDelaySeconds || 300;

    log(
      'INFO',
      `[${roomId}] 有录制进行中，${delaySec}s 后重新尝试转码 ${path.basename(srcFile)}`
    );

    const e = new Error('转码因录制暂停');
    e.code = 'PAUSE_DEFERRED';

    requeueWithDelay(
      roomId,
      srcFile,
      serverCfg,
      delaySec * 1000,
      0
    );

    throw e;
  }

  const ext = path.extname(srcFile);

  const prevDir = path.resolve(
    ROOT,
    serverCfg.paths.previews,
    roomId,
    path.basename(srcFile, ext)
  );

  // 每次重新转码前清理旧文件，避免上次失败留下残缺文件
  await fsp.rm(prevDir, {
    recursive: true,
    force: true
  });

  ensureDir(prevDir);

  const m3u8 = path.join(prevDir, 'index.m3u8');
  const endFile = path.join(prevDir, '.end');

  const args = [
    '-i',
    srcFile,
    '-vf',
    `scale=${t.scale},fps=${t.fps}`,
    '-c:v',
    'libx264',
    '-b:v',
    t.videoBitrate,
    '-maxrate',
    t.maxrate,
    '-bufsize',
    t.bufsize,
    '-preset',
    t.preset,
    '-profile:v',
    t.profile,
    '-c:a',
    'aac',
    '-b:a',
    t.audioBitrate,
    '-ar',
    String(t.audioSampleRate),
    '-f',
    'hls',
    '-hls_time',
    String(t.hlsSegmentTime || 6),
    '-hls_list_size',
    '0',
    '-hls_segment_filename',
    path.join(prevDir, 'seg_%05d.ts'),
    '-y',
    m3u8
  ];

  if (
    anyRecording &&
    conflict.policy === 'slowdown' &&
    conflict.slowdown?.threads
  ) {
    args.unshift(
      '-threads',
      String(conflict.slowdown.threads)
    );
  }

  log('INFO', `[${roomId}] 开始转码 ${path.basename(srcFile)}`);

    // 记录正在转码的原片
  const sourceKey = path.resolve(srcFile);

  transcodingFiles.add(sourceKey);
  
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(
        serverCfg.ffmpeg.path,
        args,
        {
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe']
        }
      );

      // 登记 FFmpeg 进程
      transcodeProcesses.set(sourceKey, proc);

      let spawnError = null;

      // 记录进程真正关闭的 Promise
      const closePromise = new Promise(resolveClose => {
        proc.stderr.on('data', () => {});

        // 启动错误先记录，等待 close 后统一处理
        proc.on('error', e => {
          spawnError = e;
        });

        proc.once('close', (code, signal) => {
          resolveClose({
            code,
            signal,
            error: spawnError
          });
        });
      });

      transcodeClosePromises.set(sourceKey, closePromise);

      closePromise.then(result => {
        // 管理员主动取消的任务不算普通转码失败
        if (cancelledTranscodes.has(sourceKey)) {
          const e = new Error('转码任务已被管理员取消');
          e.code = 'TRANSCODE_CANCELLED';
          reject(e);
          return;
        }

        if (result.error) {
          reject(result.error);
          return;
        }

        if (result.code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `ffmpeg exit ${result.code}, signal ${result.signal || 'none'}`
            )
          );
        }
      });
    });

    // FFmpeg 退出码为 0 后，继续检查 HLS 产物
    const segmentCount = await validateHlsOutput(
      prevDir,
      m3u8
    );

    // 所有 TS 文件确认就绪后，才生成完成标记
    await fsp.writeFile(endFile, '');

    log(
      'INFO',
      `[${roomId}] 转码完成 ${path.basename(srcFile)}，共 ${segmentCount} 个 TS 分片`
    );

  } catch (e) {
    // 转码失败时不允许留下完成标记
    await fsp.rm(endFile, {
      force: true
    }).catch(() => {});

    // 清理本次失败产生的残缺预览文件
    await fsp.rm(prevDir, {
      recursive: true,
      force: true
    }).catch(() => {});

    throw e;

  } finally {
    // 清理进程记录和运行状态
    transcodeProcesses.delete(sourceKey);
    transcodeClosePromises.delete(sourceKey);
    transcodingFiles.delete(sourceKey);
    cancelledTranscodes.delete(sourceKey);
  }
}

async function recoverTranscodeQueue(serverCfg) {
  if (!serverCfg.previewTranscode?.enabled) return;

  const recDir = path.resolve(ROOT, serverCfg.paths.recordings);
  const prevBase = path.resolve(ROOT, serverCfg.paths.previews);

  const rooms = await fsp.readdir(recDir).catch(() => []);
  let queued = 0;

  for (const roomId of rooms) {
    const dir = path.join(recDir, roomId);

    const st = await fsp.stat(dir).catch(() => null);
    if (!st || !st.isDirectory()) continue;

    const files = await listRecordingFiles(dir);
    const activeFile = recordingProcs.get(roomId)?.fileName;

    for (const f of files) {
      if (f.fileName === activeFile) continue;

      const endFile = path.join(
        prevBase,
        roomId,
        f.fileId,
        '.end'
      );

      const srcFile = path.join(dir, f.fileName);

      if (
        !fs.existsSync(endFile) &&
        !isTranscodeActiveOrQueued(srcFile)
      ) {
        log('INFO', `[recover] 补录转码 ${roomId}/${f.fileName}`);

        if (
          enqueueRecovered(
            roomId,
            srcFile,
            serverCfg
          )
        ) {
          queued++;
        }
      }
    }
  }

  if (queued > 0) {
    log('INFO', `[recover] 共补录 ${queued} 个转码任务`);
    runTranscodeQueue();
  }
}

// ---------- stats ----------
let statsCache = null;
let statsDirty = false;
let statsWriting = false;

function loadStats() {
  if (statsCache) return statsCache;

  try {
    statsCache = JSON.parse(
      fs.readFileSync(STATS_FILE, 'utf8')
    );
  } catch (e) {
    log('WARN', `stats.json 读取失败，重置：${e.message}`);
    statsCache = {};
  }

  return statsCache;
}

function scheduleStatsSave() {
  if (statsWriting) {
    statsDirty = true;
    return;
  }

  statsWriting = true;

  const tmp = STATS_FILE + '.tmp';

  fs.writeFile(
    tmp,
    JSON.stringify(statsCache, null, 2),
    err => {
      if (err) {
        statsWriting = false;

        log('ERROR', `stats 写入临时文件失败 ${err.message}`);

        try {
          fs.unlinkSync(tmp);
        } catch (e2) {}

        if (statsDirty) {
          statsDirty = false;
          scheduleStatsSave();
        }

        return;
      }

      fs.rename(tmp, STATS_FILE, err2 => {
        statsWriting = false;

        if (err2) {
          log('ERROR', `stats 重命名失败 ${err2.message}`);
        }

        if (statsDirty) {
          statsDirty = false;
          scheduleStatsSave();
        }
      });
    }
  );
}

function bumpStat(userId, date, delta) {
  const s = loadStats();
  const key = `${userId}_${date}`;

  s[key] = Math.max(0, (s[key] || 0) + delta);

  scheduleStatsSave();

  return s[key];
}

function getStat(userId, date) {
  return loadStats()[`${userId}_${date}`] || 0;
}

// ---------- 切片 ----------
const clipQueue = [];
const clipTasks = new Map();

// 正在执行切片的 FFmpeg 进程
const clipProcesses = new Map();

let clipRunning = 0;

// 清理切片任务历史记录，限制任务记录数量
function pruneClipTasks(serverCfg) {
  const clipCfg = serverCfg.clip || {};

  const configuredRetention = Number(
    clipCfg.taskRetentionHours
  );

  const retentionMs =
    Number.isFinite(configuredRetention) && configuredRetention > 0
      ? configuredRetention * 3600 * 1000
      : 24 * 3600 * 1000;

  const configuredMax = Number(
    clipCfg.maxTaskHistory
  );

  const maxTasks =
    Number.isInteger(configuredMax) && configuredMax > 0
      ? configuredMax
      : 500;

  const now = Date.now();

  const finishedTasks = [];

  // 只清理已经完成或失败的任务
  for (const [taskId, task] of clipTasks) {
    if (
      task.status !== 'done' &&
      task.status !== 'failed'
    ) {
      continue;
    }

    const finishedAt = task.finishedAt || task.createdAt || now;

    // 超过保留时间，直接删除历史记录
    if (now - finishedAt >= retentionMs) {
      clipTasks.delete(taskId);
      continue;
    }

    finishedTasks.push({
      taskId,
      finishedAt
    });
  }

  // 最早完成的任务排在前面
  finishedTasks.sort(
    (a, b) => a.finishedAt - b.finishedAt
  );

  // 超过最大记录数量时，优先删除最早完成的历史任务
  while (
    clipTasks.size >= maxTasks &&
    finishedTasks.length
  ) {
    const oldest = finishedTasks.shift();

    clipTasks.delete(oldest.taskId);
  }

  // 返回是否还有空间保存新任务
  return clipTasks.size < maxTasks;
}

async function submitClip(session, body, serverCfg) {
  if (session.username === '#admin#') {
    throw new Error('管理员账号不可切片');
  }

  const { roomId, fileId, start, end } = body || {};
  const roomIdStr = String(roomId);

  if (!safeName(roomIdStr) || !safeName(fileId)) {
    throw new Error('参数非法');
  }

  const startSec = parseHMS(start);
  const endSec = parseHMS(end);

  if (startSec === null || endSec === null) {
    throw new Error('时间格式错误');
  }

  if (startSec > MAX_CLIP_SECONDS) {
    throw new Error('起点超出范围');
  }

  if (endSec > MAX_CLIP_SECONDS) {
    throw new Error('终点超出范围');
  }
  if (endSec <= startSec) throw new Error('终点必须大于起点');

  const userId = session.username;
  const today = stampDate(new Date());

  if (
    getStat(userId, today) >=
    (serverCfg.clip.dailyLimit || 10)
  ) {
    throw new Error('今日切片已达上限');
  }

  const tempBase = path.resolve(
    ROOT,
    serverCfg.paths.tempvideo,
    userId
  );

  ensureDir(tempBase);

  const files = (
    await fsp.readdir(tempBase)
  ).filter(f => f.endsWith('.mp4'));

  if (files.length >= serverCfg.clip.maxHardLimit) {
    throw new Error('切片文件过多，请先删除或等待清理');
  }

  const roomDir = path.resolve(
    ROOT,
    serverCfg.paths.recordings,
    roomIdStr
  );

  const found = findRecordingFile(roomDir, fileId);

  if (!found) {
    throw new Error('原片不存在');
  }

  const srcFile = found.fp;
  
  // 原片正在删除时，不允许提交新的切片任务
  if (deletingRecordingFiles.has(path.resolve(srcFile))) {
    throw new Error('原片正在删除，请稍后重试');
  }

  const m = fileId.match(
    new RegExp(`^${roomIdStr}_(\\d{8})_(\\d+)$`)
  );

  if (!m) {
    throw new Error('文件标识非法');
  }

  const outName =
    `${m[1]}_${m[2]}_${toHMS(startSec)}_${toHMS(endSec)}.mp4`;

  // 清理过期任务，并检查任务记录是否还有空间
  if (!pruneClipTasks(serverCfg)) {
    throw new Error('切片任务记录已满，请稍后重试');
  }

  // 检查等待队列数量
  const configuredMaxQueue = Number(
    serverCfg.clip.maxQueue
  );

  const maxQueue =
    Number.isInteger(configuredMaxQueue) && configuredMaxQueue > 0
      ? configuredMaxQueue
      : 100;

  if (clipQueue.length >= maxQueue) {
    throw new Error('切片任务队列已满，请稍后重试');
  }

  const outFile = path.join(tempBase, outName);
  const taskId = crypto.randomBytes(8).toString('hex');

  const task = {
    taskId,
    status: 'queued',
    userId,
    outFile,
    srcFile,
    startSec,
    endSec,
    outName,
    error: null,
    createdAt: Date.now(),
    finishedAt: null
  };

  clipTasks.set(taskId, task);
  clipQueue.push(task);

  bumpStat(userId, today, +1);

  runClipQueue(serverCfg);

  return {
    taskId,
    outName
  };
}

async function runClipQueue(serverCfg) {
  if (isShuttingDown) return;

  const max = serverCfg.clip.maxConcurrent || 1;

  while (
    !isShuttingDown &&
    clipRunning < max &&
    clipQueue.length
  ) {
    const task = clipQueue.shift();

    clipRunning++;
    task.status = 'running';

    processClipTask(task, serverCfg);
  }
}

async function processClipTask(task, serverCfg) {
  try {
    await runFfmpegClip(task, serverCfg);

    task.status = 'done';
    task.finishedAt = Date.now();

  } catch (e) {
    task.status = 'failed';
    task.error = e.message;
    task.finishedAt = Date.now();

    try {
      if (fs.existsSync(task.outFile)) {
        fs.unlinkSync(task.outFile);
      }
    } catch (e2) {}

    bumpStat(
      task.userId,
      stampDate(new Date()),
      -1
    );

    log('ERROR', `切片失败 ${task.taskId}: ${e.message}`);

  } finally {
    clipRunning--;
    runClipQueue(serverCfg);
  }
}

async function runFfmpegClip(task, serverCfg) {
  if (isShuttingDown) {
    throw new Error('服务正在关闭');
  }

  const duration = task.endSec - task.startSec;

  const args = [
    '-ss',
    String(task.startSec),
    '-i',
    task.srcFile,
    '-t',
    String(duration),
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    '-f',
    'mp4',
    '-y',
    task.outFile
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn(
      serverCfg.ffmpeg.path,
      args,
      {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      }
    );

    clipProcesses.set(task.taskId, proc);

    proc.stderr.on('data', () => {});

    proc.on('error', reject);

    proc.on('close', code => {
      clipProcesses.delete(task.taskId);

      if (isShuttingDown) {
        reject(new Error('服务关闭，切片任务已终止'));
        return;
      }

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exit ${code}`));
      }
    });
  });
}

// ---------- 下载中 ----------
const downloading = new Map();

// ---------- 清理 ----------
let lastRawCleanupAt = 0;

async function cleanupTask(serverCfg) {
  // 定期清理过期的切片任务记录
  pruneClipTasks(serverCfg);

  const tempBase = path.resolve(
    ROOT,
    serverCfg.paths.tempvideo
  );

  const recDir = path.resolve(
    ROOT,
    serverCfg.paths.recordings
  );

  const retentionMs =
    (serverCfg.clip.retentionHours || 6) * 3600 * 1000;

  try {
    const users = await fsp.readdir(tempBase).catch(() => []);

    for (const userId of users) {
      const dir = path.join(tempBase, userId);

      const st = await fsp.stat(dir).catch(() => null);
      if (!st || !st.isDirectory()) continue;

      const files = await fsp.readdir(dir).catch(() => []);
      const items = [];

      for (const f of files) {
        if (!f.endsWith('.mp4')) continue;

        const fp = path.join(dir, f);
        const st2 = await fsp.stat(fp).catch(() => null);

        if (st2) {
          items.push({
            name: f,
            fp,
            mtime: st2.mtimeMs
          });
        }
      }

      for (const it of items) {
        if (
          Date.now() - it.mtime > retentionMs &&
          !downloading.get(userId)?.has(it.name)
        ) {
          try {
            await fsp.unlink(it.fp);

            log(
              'INFO',
              `[cleanup] 删除超时切片 ${userId}/${it.name}`
            );
          } catch (e) {
            if (e.code !== 'ENOENT') {
              log(
                'WARN',
                `[cleanup] 删除失败 ${it.fp}: ${e.message}`
              );
            }
          }
        }
      }

      const remain = items
        .filter(it => fs.existsSync(it.fp))
        .sort((a, b) => a.mtime - b.mtime);

      let over = remain.length - (serverCfg.clip.maxFiles || 5);

      for (const it of remain) {
        if (over <= 0) break;

        if (downloading.get(userId)?.has(it.name)) {
          continue;
        }

        try {
          await fsp.unlink(it.fp);

          log(
            'INFO',
            `[cleanup] 删除超限切片 ${userId}/${it.name}`
          );
        } catch (e) {
          if (e.code !== 'ENOENT') {
            log(
              'WARN',
              `[cleanup] 删除失败 ${it.fp}: ${e.message}`
            );
          }
        }

        over--;
      }
    }
  } catch (e) {
    log('ERROR', `[cleanup] 切片清理异常：${e.message}`);
  }

    // ---------- 原始录制文件清理 ----------
  const raw = serverCfg.storage?.rawRetention;
  if (!raw) return;

  const rawCheckMs = (raw.checkIntervalHours || 6) * 3600 * 1000;
  if (Date.now() - lastRawCleanupAt < rawCheckMs) return;
  lastRawCleanupAt = Date.now();

  try {
    const rooms = await fsp.readdir(recDir).catch(() => []);
    const all = [];

    for (const roomId of rooms) {
      const dir = path.join(recDir, roomId);
      const st = await fsp.stat(dir).catch(() => null);
      if (!st || !st.isDirectory()) continue;

      const files = await listRecordingFiles(dir);

      for (const f of files) {
        const fp = path.resolve(dir, f.fileName);
        const st2 = await fsp.stat(fp).catch(() => null);
        if (!st2) continue;

        
        // 正在录制、转码、等待转码、切片的原片不能自动清理
        const activeRecording =
          recordingProcs.get(roomId)?.fileName === f.fileName;

        const activeTranscoding =
          transcodingFiles.has(fp);

        const queuedTranscoding =
          isTranscodeQueued(fp);

        const activeClipping =
          isClipUsingSource(fp);

        all.push({
          fp,
          roomId,
          fileId: f.fileId,
          fileName: f.fileName,
          mtime: st2.mtimeMs,
          size: st2.size,
          protected:
            activeRecording ||
            activeTranscoding ||
            queuedTranscoding ||
            activeClipping
        });
      }
    }

    const ageMs = (raw.maxAgeDays || 30) * 86400 * 1000;

    
    // 先清理超过保留期限的原始文件
    for (const it of all) {
      // 扫描时受保护，或者当前正在使用，都不能删除
      if (
      it.protected ||
        isClipUsingSource(it.fp) ||
        recordingProcs.get(it.roomId)?.fileName === it.fileName ||
        transcodingFiles.has(path.resolve(it.fp)) ||
        isTranscodeQueued(it.fp)
      ) {
        continue;
      }

      if (Date.now() - it.mtime > ageMs && fs.existsSync(it.fp)) {
        const sourceKey = path.resolve(it.fp);

        if (deletingRecordingFiles.has(sourceKey)) {
          continue;
        }

        // 再次检查原片是否正在使用
        if (
          isClipUsingSource(sourceKey) ||
          recordingProcs.get(it.roomId)?.fileName === it.fileName ||
          isTranscodeActiveOrQueued(sourceKey)
        ) {
          continue;
        }

        deletingRecordingFiles.add(sourceKey);

        try {
          await fsp.unlink(sourceKey);

          // 原片删除成功后，同步删除 HLS 预览目录
          try {
            await removePreviewDirectory(
              it.roomId,
              it.fileId,
              serverCfg
            );
          } catch (e) {
            log(
              'WARN',
              `[cleanup] 删除超期原片的预览目录失败 ${it.roomId}/${it.fileId}: ${e.message}`
            );
          }

          log(
            'INFO',
            `[cleanup] 删除超期原片 ${sourceKey}`
          );

        } catch (e) {
          if (e.code !== 'ENOENT') {
            log(
              'WARN',
              `[cleanup] 删除原片失败 ${sourceKey}: ${e.message}`
            );
          }
        } finally {
          deletingRecordingFiles.delete(sourceKey);
        }
      }
    }

    // 再检查原始录屏总容量
    const alive = all
      .filter(it =>
        !it.protected &&
        !isClipUsingSource(it.fp) &&
        fs.existsSync(it.fp)
      )
      .sort((a, b) => a.mtime - b.mtime);


    let totalGB = alive.reduce((sum, it) => sum + it.size, 0) / (1024 ** 3);
    const limit = raw.maxTotalGB || 2000;
    
    for (const it of alive) {
      if (totalGB <= limit) break;
      if (!fs.existsSync(it.fp)) continue;

      // 删除前再次检查，避免清理过程中开始新的切片任务
      const sourceKey = path.resolve(it.fp);

      if (
        deletingRecordingFiles.has(sourceKey) ||
        isClipUsingSource(sourceKey) ||
        recordingProcs.get(it.roomId)?.fileName === it.fileName ||
        isTranscodeActiveOrQueued(sourceKey)
      ) {
        continue;
      }


      deletingRecordingFiles.add(sourceKey);

      try {
        await fsp.unlink(sourceKey);

        // 原片删除成功后，同步删除 HLS 预览目录
        try {
          await removePreviewDirectory(
            it.roomId,
            it.fileId,
            serverCfg
          );
        } catch (e) {
          log(
            'WARN',
            `[cleanup] 删除容量超限原片的预览目录失败 ${it.roomId}/${it.fileId}: ${e.message}`
          );
        }

        totalGB -= it.size / (1024 ** 3);

        log(
          'INFO',
          `[cleanup] 删除原片释放容量 ${sourceKey}`
        );

      } catch (e) {
        if (e.code !== 'ENOENT') {
          log(
            'WARN',
            `[cleanup] 删除原片失败 ${sourceKey}: ${e.message}`
          );
        }
      } finally {
        deletingRecordingFiles.delete(sourceKey);
      }
    }
  } catch (e) {
    log('WARN', `原片清理异常 ${e.message}`);
  }
}

// ---------- Express 应用 ----------

function buildApp(serverCfg, roomsData) {
  const app = express();
  const basePath = normalizeBasePath(serverCfg.server.basePath);
  const router = express.Router();

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // ---------- 用户登录 ----------
  router.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        error: '用户名或密码不能为空'
      });
    }

    const runtime = loadRuntime();
    const user = runtime.users.find(u => u.username === username);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({
        ok: false,
        error: '用户名或密码错误'
      });
    }

    const sid = createSession(user.username, user.role);

    res.cookie('sid', sid, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 86400000
    });

    res.json({
      ok: true,
      username: user.username
    });
  });

  // ---------- 用户退出 ----------
  router.post('/api/logout', (req, res) => {
    const sid = req.cookies?.sid;

    if (sid) destroySession(sid);

    res.clearCookie('sid');
    res.json({ ok: true });
  });

  // ---------- 管理员验证 ----------
  router.post('/api/admin/login', (req, res) => {
    const { password } = req.body || {};

    if (!password) {
      return res.status(400).json({
        ok: false,
        error: '请输入管理员密码'
      });
    }

    const runtime = loadRuntime();

    if (
      !runtime.admin?.passwordHash ||
      !verifyPassword(password, runtime.admin.passwordHash)
    ) {
      return res.status(401).json({
        ok: false,
        error: '管理员密码错误'
      });
    }

    let sid = req.cookies?.sid;
    let session = sid ? getSession(sid) : null;

    if (!session) {
      sid = createSession('#admin#', 'admin', true);

      res.cookie('sid', sid, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 86400000
      });
    } else {
      session.adminAuthenticated = true;
      session.adminAuthenticatedAt = Date.now();
      saveSessions();
    }

    res.json({ ok: true });
  });

  // ---------- 切片下载 ----------
  router.get('/api/clips/download/:userId/:fileName', async (req, res) => {
    const { userId, fileName } = req.params;
    const { token, expires } = req.query;

    if (!token || !expires) {
      return res.status(400).end('missing token');
    }

    if (Date.now() > Number(expires)) {
      return res.status(410).end('expired');
    }

    if (!safeName(userId) || !isClipFileName(fileName)) {
      return res.status(400).end('bad params');
    }

    const runtime = loadRuntime();
    const expected = signDownload(
      userId,
      fileName,
      expires,
      runtime.downloadSecret
    );

    if (!safeEqualHex(expected, token)) {
      return res.status(403).end('bad token');
    }

    if (!downloading.has(userId)) {
      downloading.set(userId, new Set());
    }

    const set = downloading.get(userId);

    if (set.size >= (serverCfg.clip.maxConcurrentDownloads || 3)) {
      return res.status(429).end('too many downloads');
    }

    const dir = path.resolve(ROOT, serverCfg.paths.tempvideo, userId);
    const fp = path.resolve(dir, fileName);

    if (!isPathInside(dir, fp) || !fs.existsSync(fp)) {
      return res.status(404).end('not found');
    }

    set.add(fileName);

    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      set.delete(fileName);

      if (set.size === 0) {
        downloading.delete(userId);
      }
    };

    res.on('close', cleanup);
    res.on('finish', cleanup);
    res.download(fp, fileName, err => {
      if (err) cleanup();
    });
  });

  // ---------- 登录页面 ----------
  router.get(['/login', '/login.html'], (req, res) => {
    if (getSessionFromReq(req)) {
      return res.redirect(basePath);
    }

    res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
  });

  // 静态资源不要求登录
  router.use('/static', express.static(PUBLIC_STATIC_DIR));

  // 注意：关掉 extensions 自动补全，让后面的路由精确处理
  router.use(express.static(PUBLIC_DIR, { 
    index: false 
  }));

  // ---------- 登录验证中间件 ----------
  router.use((req, res, next) => {
    if (
      req.path === '/api/login' ||
      req.path === '/api/logout' ||
      req.path === '/api/admin/login'
    ) {
      return next();
    }

    if (req.path.startsWith('/api/clips/download/')) {
      return next();
    }

    if (
      req.path === '/login' ||
      req.path === '/login.html' ||
      req.path.startsWith('/static/') ||
      req.path === '/favicon.ico'
    ) {
      return next();
    }

    const session = getSessionFromReq(req);

    if (!session) {
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({
          ok: false,
          error: 'unauthorized'
        });
      }

      return res.redirect(
        path.posix.join(basePath, 'login')
      );
    }

    req.session = session;
    next();
  });

  // ---------- 页面路由 ----------
  
  // 1. 处理首页
  router.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // 2. 处理录屏列表页（兼容有无 .html 后缀）
  router.get(['/list', '/list.html'], (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'list.html'));
  });

  // 3. 处理视频播放页
  router.get(['/video', '/video.html'], (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'video.html'));
  });

  // 4. 处理管理员页面：直接放行，前端自带密码验证逻辑
  // 任何已登录的用户直接访问 /admin 或 /admin.html 都能看到页面（未验证密码则只显示密码框）
  router.get(['/admin', '/admin.html'], (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
  });

  // 兼容 video.html 的文件参数形式：
  // /video?=roomId_YYYYMMDD_序号
  // /video?file=roomId_YYYYMMDD_序号
  // /video?id=roomId_YYYYMMDD_序号
  //
  // 参数由 video.html 前端读取，后端不改变 fileId 格式。

  // ---------- 当前登录信息 ----------
  router.get('/api/me', (req, res) => {
    res.json({
      ok: true,
      username: req.session.username,
      adminAuthenticated: !!req.session.adminAuthenticated
    });
  });

  // ---------- 用户修改密码 ----------
  router.post('/api/password', (req, res) => {
    if (req.session.username === '#admin#') {
      return res.status(403).json({
        ok: false,
        error: '管理员密码不可在线修改'
      });
    }

    const { oldPassword, newPassword } = req.body || {};

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        ok: false,
        error: '新密码至少 6 位'
      });
    }

    const runtime = loadRuntime();
    const user = runtime.users.find(
      u => u.username === req.session.username
    );

    if (!user || !verifyPassword(oldPassword, user.passwordHash)) {
      return res.status(400).json({
        ok: false,
        error: '旧密码错误'
      });
    }

    user.passwordHash = hashPassword(newPassword);
    saveRuntime(runtime);

    const sid = req.cookies?.sid;
    if (sid) destroySession(sid);

    res.clearCookie('sid');

    res.json({
      ok: true,
      msg: '密码已修改，请重新登录'
    });
  });
    // ---------- 原始录屏列表 ----------
  router.get('/api/recordings', async (req, res) => {
    const recDir = path.resolve(ROOT, serverCfg.paths.recordings);
    const rooms = await fsp.readdir(recDir).catch(() => []);
    const list = [];

    for (const roomId of rooms) {
      const dir = path.join(recDir, roomId);
      const st = await fsp.stat(dir).catch(() => null);
      if (!st || !st.isDirectory()) continue;

      const files = await listRecordingFiles(dir);
      const recordingFile = recordingProcs.get(roomId)?.fileName;

      for (const f of files) {
        const fp = path.join(dir, f.fileName);
        const st2 = await fsp.stat(fp).catch(() => null);
        if (!st2) continue;

        let status = 'ready';

        if (recordingFile === f.fileName) {
          status = 'recording';
        } else if (
          !fs.existsSync(
            path.resolve(
              ROOT,
              serverCfg.paths.previews,
              roomId,
              f.fileId,
              '.end'
            )
          )
        ) {
          status = 'transcoding';
        }

        list.push({
          roomId,
          fileId: f.fileId,
          fileName: f.fileName,
          size: st2.size,
          createdAt: st2.mtimeMs,
          status
        });
      }
    }

    list.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ ok: true, items: list });
  });

  // ---------- HLS 视频流 ----------
  router.get('/stream/:roomId/:fileId/:seg', (req, res) => {
    const { roomId, fileId, seg } = req.params;
    const clean = seg.replace(/\.(ts|m3u8)$/, '');

    if (
      !safeName(roomId) ||
      !safeName(fileId) ||
      !safeName(clean)
    ) {
      return res.status(400).end();
    }

    const prevDir = path.resolve(
      ROOT,
      serverCfg.paths.previews,
      roomId,
      fileId
    );

    const fp = path.resolve(prevDir, seg);

    if (!isPathInside(prevDir, fp)) {
      return res.status(403).end();
    }

    if (!fs.existsSync(fp)) {
      return res.status(404).end();
    }

    res.sendFile(fp);
  });

  // ---------- 提交切片任务 ----------
  router.post('/api/clip', async (req, res) => {
    try {
      const result = await submitClip(
        req.session,
        req.body,
        serverCfg
      );

      res.json({
        ok: true,
        ...result
      });
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e.message
      });
    }
  });

  // ---------- 查询切片任务状态 ----------
  router.get('/api/clip/:taskId/status', (req, res) => {
    const task = clipTasks.get(req.params.taskId);

    if (!task || task.userId !== req.session.username) {
      return res.status(404).json({ ok: false });
    }

    let downloadUrl = null;

    if (task.status === 'done') {
      const runtime = loadRuntime();
      const expires =
        Date.now() +
        (serverCfg.clip.retentionHours || 6) * 3600 * 1000 +
        3600 * 1000;

      const token = signDownload(
        task.userId,
        task.outName,
        expires,
        runtime.downloadSecret
      );

      downloadUrl =
        path.posix.join(
          basePath,
          'api/clips/download',
          encodeURIComponent(task.userId),
          encodeURIComponent(task.outName)
        ) + `?token=${token}&expires=${expires}`;
    }

    res.json({
      ok: true,
      status: task.status,
      error: task.error,
      outName: task.status === 'done' ? task.outName : null,
      downloadUrl
    });
  });

    // ---------- 当前用户今日切片配额 ----------
  router.get('/api/stats/today', (req, res) => {
    const userId = req.session.username;
    const today = stampDate(new Date());

    res.json({
      ok: true,
      count: getStat(userId, today),
      limit: serverCfg.clip.dailyLimit || 10
    });
  });

  // ---------- 当前用户的切片列表 ----------
  router.get('/api/clips/mine', async (req, res) => {
    const userId = req.session.username;
    const dir = path.resolve(
      ROOT,
      serverCfg.paths.tempvideo,
      userId
    );

    const files = await fsp.readdir(dir).catch(() => []);
    const runtime = loadRuntime();
    const items = [];

    for (const fileName of files) {
      if (!fileName.endsWith('.mp4')) continue;
      if (!isClipFileName(fileName)) continue;

      const fp = path.join(dir, fileName);
      const st = await fsp.stat(fp).catch(() => null);
      if (!st || !st.isFile()) continue;

      const expires =
        Date.now() +
        (serverCfg.clip.retentionHours || 6) * 3600 * 1000 +
        3600 * 1000;

      const token = signDownload(
        userId,
        fileName,
        expires,
        runtime.downloadSecret
      );

      items.push({
        name: fileName,
        size: st.size,
        createdAt: st.mtimeMs,
        downloadUrl:
          path.posix.join(
            basePath,
            'api/clips/download',
            encodeURIComponent(userId),
            encodeURIComponent(fileName)
          ) + `?token=${token}&expires=${expires}`
      });
    }

    items.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ ok: true, items });
  });

  // ---------- 删除当前用户的切片 ----------
  router.delete('/api/clips/:fileName', async (req, res) => {
    const userId = req.session.username;
    const { fileName } = req.params;

    if (!isClipFileName(fileName)) {
      return res.status(400).json({
        ok: false,
        error: '文件名不合法'
      });
    }

    // 文件正在下载时禁止删除
    if (downloading.get(userId)?.has(fileName)) {
      return res.status(409).json({
        ok: false,
        error: '文件正在下载，无法删除'
      });
    }

    const dir = path.resolve(
      ROOT,
      serverCfg.paths.tempvideo,
      userId
    );

    const fp = path.resolve(dir, fileName);

    if (!isPathInside(dir, fp)) {
      return res.status(403).json({ ok: false });
    }

    try {
      await fsp.unlink(fp);
      res.json({ ok: true });
    } catch (e) {
      res.status(e.code === 'ENOENT' ? 404 : 500).json({
        ok: false,
        error: e.code === 'ENOENT' ? '文件不存在' : '删除失败'
      });
    }
  });

  // ---------- 管理员删除原始录屏 ----------
  router.delete(
    '/api/admin/recordings/:roomId/:fileId',
    async (req, res) => {
      // 页面登录不代表管理员验证，删除操作必须单独验证
      if (!req.session.adminAuthenticated) {
        return res.status(403).json({
          ok: false,
          error: '需要管理员验证'
        });
      }

      const { roomId, fileId } = req.params;

      if (!safeName(roomId) || !safeName(fileId)) {
        return res.status(400).json({
          ok: false,
          error: '参数不合法'
        });
      }

      const roomDir = path.resolve(
        ROOT,
        serverCfg.paths.recordings,
        roomId
      );

      const found = findRecordingFile(roomDir, fileId);

      if (!found) {
        return res.status(404).json({
          ok: false,
          error: '原始录屏不存在'
        });
      }

      const sourceFile = path.resolve(found.fp);

      
      // 当前正在录制的文件不能删除
      const activeRecording =
        recordingProcs.get(roomId)?.fileName === path.basename(sourceFile);

      if (activeRecording) {
        return res.status(409).json({
          ok: false,
          error: '该录屏正在录制，无法删除'
        });
      }

      // 正在被切片任务使用的原片不能删除
      if (isClipUsingSource(sourceFile)) {
        return res.status(409).json({
          ok: false,
          error: '该原片正在被切片任务使用，请等待切片完成后再删除'
        });
      }

      // 正在被其他删除操作处理的原片不能重复删除
      if (deletingRecordingFiles.has(sourceFile)) {
        return res.status(409).json({
          ok: false,
          error: '该原片正在处理删除操作'
        });
      }

      // 获取删除锁
      deletingRecordingFiles.add(sourceFile);

      try {
        // 再次检查，避免等待期间出现切片任务
        if (
          isClipUsingSource(sourceFile) ||
          recordingProcs.get(roomId)?.fileName === path.basename(sourceFile)
        ) {
          return res.status(409).json({
            ok: false,
            error: '该原片正在被使用，无法删除'
          });
        }

        // 1. 停止转码，移除等待队列中的任务
        await cancelTranscodeForFile(sourceFile);

        // 2. 删除对应的 HLS 预览目录
        await removePreviewDirectory(
          roomId,
          fileId,
          serverCfg
        );

        // 3. 删除原始录制文件
        await fsp.unlink(sourceFile);

        log(
          'INFO',
          `管理员 ${req.session.username} 删除原始录屏 ${roomId}/${path.basename(sourceFile)}`
        );

        return res.json({ ok: true });

      } catch (e) {
        log(
          'ERROR',
          `[admin] 删除原片失败 ${sourceFile}: ${e.message}`
        );

        // 如果原片还存在，尝试恢复 HLS 转码
        if (fs.existsSync(sourceFile)) {
          try {
            triggerTranscode(
              roomId,
              sourceFile,
              serverCfg
            );
          } catch (transcodeError) {
            log(
              'ERROR',
              `[admin] 恢复转码失败 ${sourceFile}: ${transcodeError.message}`
            );
          }
        }

        return res.status(500).json({
          ok: false,
          error: `删除原始录屏失败：${e.message}`
        });

      } finally {
        // 无论成功、失败还是提前返回，都释放删除锁
        deletingRecordingFiles.delete(sourceFile);
      }
    }
  );

  app.use(basePath, router);
  return app;
}


// ============================================================
// 终端命令管理
// ============================================================

let terminal = null;

// 标记是否正在执行终端命令
let terminalCommandRunning = false;

// 输出服务器日志，同时保持终端提示符正常显示
function terminalPrint(...args) {
  const canRedraw =
    terminal &&
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    !terminalCommandRunning;

  // 清除当前输入行，避免日志与用户输入重叠
  if (canRedraw) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  }

  console.log(...args);

  // 重新显示提示符，并保留当前输入内容
  if (canRedraw && !isShuttingDown) {
    terminal.prompt(true);
  }
}



function saveRooms(roomsData) {
  const tmp = ROOMS_CFG + '.tmp';

  try {
    fs.writeFileSync(tmp, JSON.stringify(roomsData, null, 2));
    fs.renameSync(tmp, ROOMS_CFG);
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (e2) {}

    throw e;
  }
}

function showHelp() {
  console.log(`
可用命令：

  user set <用户名> <密码>       添加用户或重置用户密码
  user delete <用户名>           删除用户
  user list                      查看用户
  
  admin password <新密码>        修改管理员密码
  
  help                           显示帮助
  exit                           关闭服务
  reinitialize                   重置服务端（重置所有json配置并停止运行server.js）

  room add <房间号>              添加房间号
  room delete <房间号>           删除房间号
  room rec <房间号/昵称> <true/false>  房间开始/停止录制（支持1/0）
  room list <房间号/昵称>         显示该房间直播和录制状态
`);
}

function findRoom(roomsData, roomId) {
  return roomsData.rooms.find(
    r => String(r.roomId) === String(roomId)
  );
}


// 根据房间号或主播昵称查找直播间
function findRoomByIdentifier(roomsData, identifier) {
  const value = String(identifier || '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');

  if (!value) return undefined;

  // 优先按房间号查找
  const roomById = roomsData.rooms.find(
    r => String(r.roomId) === value
  );

  if (roomById) return roomById;

  // 再按主播昵称查找，不区分英文大小写
  return roomsData.rooms.find(
    r => String(r.nick || '').trim().toLowerCase() === value.toLowerCase()
  );
}

async function terminalCommand(line, serverCfg, roomsData) {
  const args = line.trim().split(/\s+/).filter(Boolean);

  if (!args.length) return;

  const command = args[0].toLowerCase();

  // ---------- help ----------
  if (command === 'help') {
    showHelp();
    return;
  }

  // ---------- exit ----------
  if (command === 'exit') {
    console.log('[终端] 正在关闭服务...');
    shutdown('TERMINAL_EXIT');
    return;
  }

  // ---------- reinitialize ----------
  if (command === 'reinitialize') {
    console.log('[终端] 正在重置服务端配置...');

    const files = [
      SERVER_CFG,
      RUNTIME_CFG,
      ROOMS_CFG,
      SESSION_FILE,
      STATS_FILE
    ];

    for (const file of files) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          console.log(`[重置] 已删除 ${path.basename(file)}`);
        }
      } catch (e) {
        console.error(`[重置] 删除失败：${file} ${e.message}`);
        return;
      }
    }

    console.log('[终端] JSON 配置已重置。');
    console.log('[终端] 服务即将关闭，请重新运行 node server.js。');

    shutdown('REINITIALIZE');
    return;
  }
  
  // ==========================================================
  // 管理员管理
  // ==========================================================

  if (command === 'admin') {
    const action = args[1]?.toLowerCase();

    if (action === 'password') {
      const newPassword = args[2];

      if (!newPassword) {
        console.log('用法：admin password <新密码>');
        return;
      }

      if (newPassword.length < 6) {
        console.log('[错误] 管理员密码至少需要 6 位。');
        return;
      }

      const runtime = loadRuntime();

      if (!runtime.admin) {
        console.log('[错误] 管理员配置不存在，无法修改密码。');
        return;
      }

      runtime.admin.passwordHash = hashPassword(newPassword);

      saveRuntime(runtime);

      console.log('[管理员] 密码修改成功。');
      console.log('[管理员] 请使用新密码登录管理后台。');
      return;
    }

    console.log('[错误] 未知管理员命令，输入 help 查看帮助。');
    return;
  }


  // ==========================================================
  // 用户管理
  // ==========================================================

  if (command === 'user') {
    const action = args[1];

    // ---------- user list ----------
    if (action === 'list') {
      const runtime = loadRuntime();

      console.log('\n========== 用户列表 ==========');

      console.log('用户名'.padEnd(24) + '角色');
      console.log('-'.repeat(35));

      for (const user of runtime.users) {
        console.log(
          user.username.padEnd(24) +
          (user.role || 'user')
        );
      }

      console.log(`\n用户总数：${runtime.users.length}`);
      return;
    }

    // ---------- user set ----------
    if (action === 'set') {
      const username = args[2];
      const password = args[3];

      if (!username || !password) {
        console.log('用法：user set <用户名> <密码>');
        return;
      }

      if (!safeName(username) || username === '#admin#') {
        console.log('[错误] 用户名只能包含英文字母、数字、下划线和连字符。');
        return;
      }

      if (password.length < 6) {
        console.log('[错误] 密码至少需要 6 位。');
        return;
      }

      const runtime = loadRuntime();

      if (!Array.isArray(runtime.users)) {
        runtime.users = [];
      }

      let user = runtime.users.find(
        u => u.username === username
      );

      if (user) {
        user.passwordHash = hashPassword(password);
        console.log(`[用户] 已重置用户密码：${username}`);
      } else {
        runtime.users.push({
          username,
          passwordHash: hashPassword(password),
          role: 'user'
        });

        console.log(`[用户] 已添加用户：${username}`);
      }

      saveRuntime(runtime);

      // 密码变更后，注销该用户的所有会话
      for (const [sid, session] of Object.entries(sessions)) {
        if (session.username === username) {
          delete sessions[sid];
        }
      }

      saveSessions();

      return;
    }

    // ---------- user delete ----------
    if (action === 'delete') {
      const username = args[2];

      if (!username) {
        console.log('用法：user delete <用户名>');
        return;
      }

      const runtime = loadRuntime();

      const index = runtime.users.findIndex(
        u => u.username === username
      );

      if (index === -1) {
        console.log(`[错误] 用户不存在：${username}`);
        return;
      }

      runtime.users.splice(index, 1);
      saveRuntime(runtime);

      // 删除该用户的所有登录会话
      for (const [sid, session] of Object.entries(sessions)) {
        if (session.username === username) {
          delete sessions[sid];
        }
      }

      saveSessions();

      console.log(`[用户] 已删除用户：${username}`);
      return;
    }

    console.log('[错误] 未知用户命令，输入 help 查看帮助。');
    return;
  }

  // ==========================================================
  // 直播间管理
  // ==========================================================

  if (command === 'room') {
    const action = args[1];

    // ---------- room add ----------
    if (action === 'add') {
      const roomNumber = args[2];

      if (!roomNumber || !/^\d+$/.test(roomNumber)) {
        console.log('用法：room add <房间号>');
        return;
      }

      if (findRoom(roomsData, roomNumber)) {
        console.log(`[错误] 房间已存在：${roomNumber}`);
        return;
      }

      try {
        console.log(`[房间] 正在获取直播间信息：${roomNumber}`);

        const info = await biliRoomInfo(
          roomNumber,
          serverCfg.recorder.headers
        );

        const realRoomId = String(info.room_id || roomNumber);

        if (findRoom(roomsData, realRoomId)) {
          console.log(`[错误] 该直播间已经添加：${realRoomId}`);
          return;
        }

        // 获取主播昵称
        let nick = '';

        try {
          nick = await biliAnchorNick(
            info.uid,
            serverCfg.recorder.headers
          );
        } catch (e) {
          console.log(`[警告] 获取主播昵称失败：${e.message}`);
        }

        const room = {
          nick,
          id: realRoomId,
          roomId: Number(realRoomId),
          name: info.title || `直播间 ${realRoomId}`,
          quality: 10000,
          enabled: false
        };


        roomsData.rooms.push(room);
        saveRooms(roomsData);

        roomStates.set(room.id, 'idle');

        console.log('\n[房间] 添加成功');
        console.log(`房间号：${room.roomId}`);
        console.log(`房间名称：${room.name}`);
        console.log('录制状态：未启用');
      } catch (e) {
        console.log(`[错误] 获取直播间信息失败：${e.message}`);
      }

      return;
    }

    // ---------- room delete ----------
    if (action === 'delete') {
      const roomNumber = args[2];

      if (!roomNumber) {
        console.log('用法：room delete <房间号>');
        return;
      }

      const index = roomsData.rooms.findIndex(
        r => String(r.roomId) === String(roomNumber)
      );

      if (index === -1) {
        console.log(`[错误] 房间不存在：${roomNumber}`);
        return;
      }

      const room = roomsData.rooms[index];

      // 停止正在进行的录制
      stopRecording(room.id);

      // 取消之前安排的重试
      retryTokens.set(
        room.id,
        (retryTokens.get(room.id) || 0) + 1
      );

      roomStates.set(room.id, 'idle');
      crashCounters.delete(room.id);

      roomsData.rooms.splice(index, 1);
      saveRooms(roomsData);

      console.log(`[房间] 已删除：${room.roomId} (${room.name})`);
      return;
    }

    // ---------- room rec ----------
    if (action === 'rec') {
      const roomIdentifier = args.slice(2, -1).join(' ');
      const value = args[args.length - 1]?.toLowerCase();

      if (!roomIdentifier || !value) {
        console.log('用法：room rec <房间号/昵称> <true/false 或 1/0>');
        return;
      }


      if (!['true', 'false', '1', '0'].includes(value)) {
        console.log('[错误] 只允许 true、false、1、0。');
        return;
      }

      const room = findRoomByIdentifier(
        roomsData,
        roomIdentifier
      );

      if (!room) {
        console.log(`[错误] 房间不存在：${roomIdentifier}`);
        return;
      }

      const enabled = value === 'true' || value === '1';

      room.enabled = enabled;
      saveRooms(roomsData);

      // 使之前的重试任务失效
      retryTokens.set(
        room.id,
        (retryTokens.get(room.id) || 0) + 1
      );

      if (enabled) {
        console.log(`[房间] ${room.nick || '未知主播'}（${room.roomId}）已启用录制`);

        // 如果正在录制，不重复启动
        if (recordingProcs.has(room.id)) {
          console.log('[房间] 当前已经在录制，无需重复启动。');
          return;
        }

        roomStates.set(room.id, 'idle');

        try {
          console.log('[房间] 正在检查直播状态...');

          const info = await biliRoomInfo(
            room.roomId,
            serverCfg.recorder.headers
          );

          if (info.live_status === 1) {
            console.log('[房间] 正在直播，立即开始录制。');

            await startRecording(room, serverCfg);
          } else {
            console.log('[房间] 当前未开播，等待自动轮询。');
          }
        } catch (e) {
          console.log(`[房间] 检查直播状态失败：${e.message}`);
        }
      } else {
        console.log(`[房间] ${room.nick || '未知主播'}（${room.roomId}）已关闭录制`);

        // 关闭录制并停止当前任务
        const stopped = stopRecording(room.id);

        // 使重试状态失效
        roomStates.set(room.id, 'idle');
        crashCounters.delete(room.id);

        console.log(
          stopped
            ? '[房间] 已发送停止录制指令。'
            : '[房间] 当前没有正在进行的录制。'
        );
      }

      return;
    }

    // ---------- room list ----------
    if (action === 'list') {
      const roomIdentifier = args.slice(2).join(' ');

      if (!roomIdentifier) {
        console.log('用法：room list <房间号/昵称>');
        return;
      }

      const room = findRoomByIdentifier(
        roomsData,
        roomIdentifier
      );

      if (!room) {
        console.log(`[错误] 房间不存在：${roomIdentifier}`);
        return;
      }


      try {
        const info = await biliRoomInfo(
          room.roomId,
          serverCfg.recorder.headers
        );

        const recording = recordingProcs.has(room.id);

        const state = roomStates.get(room.id) || 'idle';

        console.log('\n========== 直播间状态 ==========');
        console.log(`主播昵称：${room.nick || '暂未获取'}`);
        console.log(`房间号：${room.roomId}`);
        console.log(`房间名称：${room.name}`);
        console.log(
          `直播状态：${info.live_status === 1 ? '直播中' : '未开播'}`
        );
        console.log(
          `录制开关：${room.enabled ? '已启用' : '已关闭'}`
        );
        console.log(
          `录制状态：${recording ? '正在录制' : '未录制'}`
        );
        console.log(`内部状态：${state}`);

        if (recording) {
          const rec = recordingProcs.get(room.id);

          console.log(`录制文件：${rec.fileName}`);
          console.log(
            `开始时间：${new Date(rec.startTime).toLocaleString()}`
          );
        }

        console.log('================================');
      } catch (e) {
        console.log(`[错误] 获取直播间状态失败：${e.message}`);
      }

      return;
    }

    console.log('[错误] 未知房间命令，输入 help 查看帮助。');
    return;
  }

  console.log(`[错误] 未知命令：${command}`);
  console.log('输入 help 查看可用命令。');
}

// ---------- 启动终端 ----------
function startTerminal(serverCfg, roomsData) {
  terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'XIGEMBiliREC> '
  });

  showHelp();

  terminal.prompt();

  terminal.on('line', async line => {
    terminalCommandRunning = true;

    try {
      await terminalCommand(line, serverCfg, roomsData);
    } catch (e) {
      console.error(`[终端] 命令执行失败：${e.message}`);
    } finally {
      terminalCommandRunning = false;

      if (!isShuttingDown && terminal) {
        terminal.prompt();
      }
    }
  });

  terminal.on('close', () => {
    if (!isShuttingDown) {
      console.log('[终端] 输入流已关闭，正在关闭服务...');
      shutdown('TERMINAL_CLOSED');
    }
  });
}


// ============================================================
// 程序启动入口
// ============================================================

let httpServer = null;
let cleanupTimer = null;
let nickRefreshTimer = null;
let cleanupRunning = false;
let isShuttingDown = false;

// 主播昵称每 24 小时更新一次
const NICK_REFRESH_INTERVAL = 24 * 60 * 60 * 1000;

// 启动程序
function startServer() {
  try {
    // 1. 初始化日志
    initLog();

    // 2. 初始化目录和配置文件
    initConfigs();

    log('INFO', '正在启动 XIGEMBiliREC...');

    // 3. 读取配置
    const serverCfg = loadJson(SERVER_CFG);
    const roomsData = loadJson(ROOMS_CFG);

    // 4. 检查配置
    validateConfig(serverCfg);

    if (!Array.isArray(roomsData.rooms)) {
      throw new Error('rooms.json 格式错误：rooms 必须是数组');
    }

    // 6. 创建 Express 应用
    const app = buildApp(serverCfg, roomsData);

    // 7. 启动 HTTP 服务
    const port = Number(serverCfg.server.port);
    const host = serverCfg.server.host || '127.0.0.1';

    httpServer = app.listen(port, host, () => {
      log('INFO', '====================================');
      log('INFO', 'XIGEMBiliREC 启动成功');
      log('INFO', `访问地址：http://${host}:${port}`);
      log('INFO', `监听端口：${port}`);
      log('INFO', `房间数量：${roomsData.rooms.length}`);
      log('INFO', '====================================');
      // 启动终端命令管理

      startTerminal(serverCfg, roomsData);

      // 首次启动时立即更新所有主播昵称
      refreshRoomNicknames(serverCfg, roomsData).catch(e => {
        log('ERROR', `首次更新主播昵称失败：${e.message}`);
      });

      // 每 24 小时更新一次主播昵称
      nickRefreshTimer = setInterval(() => {
        refreshRoomNicknames(serverCfg, roomsData).catch(e => {
          log('ERROR', `定时更新主播昵称失败：${e.message}`);
        });
      }, NICK_REFRESH_INTERVAL);

      // 8. 恢复未完成的转码任务
      recoverTranscodeQueue(serverCfg).catch(e => {
        log('ERROR', `恢复转码队列失败：${e.message}`);
      });

      // 9. 启动直播间轮询
      pollLoop(serverCfg, roomsData).catch(e => {
        log('ERROR', `直播间轮询异常：${e.message}`);
      });

      // 10. 启动清理任务
      cleanupTask(serverCfg).catch(e => {
        log('ERROR', `清理任务异常：${e.message}`);
      });

      const cleanupInterval =
        (serverCfg.clip.cleanupIntervalMinutes || 5) * 60 * 1000;

      cleanupTimer = setInterval(async () => {
        if (cleanupRunning) return;

        cleanupRunning = true;

        try {
          await cleanupTask(serverCfg);
        } catch (e) {
          log('ERROR', `定时清理失败：${e.message}`);
        } finally {
          cleanupRunning = false;
        }
      }, cleanupInterval);
    });

    httpServer.on('error', e => {
      log('ERROR', `HTTP 服务启动失败：${e.message}`);
      closeLog();
      process.exitCode = 1;
    });

  } catch (e) {
    console.error('XIGEMBiliREC 启动失败：', e);
    log('ERROR', `启动失败：${e.stack || e.message}`);
    closeLog();
    process.exitCode = 1;
  }
}

// 等待子进程真正退出，超时后返回 false
function waitForProcessExit(proc, timeoutMs) {
  if (
    proc.exitCode !== null ||
    proc.signalCode !== null
  ) {
    return Promise.resolve(true);
  }

  return new Promise(resolve => {
    let finished = false;

    const finish = result => {
      if (finished) return;

      finished = true;
      clearTimeout(timer);
      proc.removeListener('close', onClose);

      resolve(result);
    };

    const onClose = () => finish(true);

    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);

    proc.once('close', onClose);
  });
}

// 优雅关闭
let shutdownPromise = null;

// 优雅关闭
function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    isShuttingDown = true;

    log('INFO', `收到 ${signal}，正在关闭服务...`);

    // 1. 关闭终端输入
    if (terminal) {
      terminal.close();
      terminal = null;
    }

    // 2. 停止定时任务
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }

    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }

    if (nickRefreshTimer) {
      clearInterval(nickRefreshTimer);
      nickRefreshTimer = null;
    }

    if (transcodeWakeupTimer) {
      clearTimeout(transcodeWakeupTimer);
      transcodeWakeupTimer = null;
    }

    // 3. 使所有未完成的录制启动请求失效
    for (const roomId of recordingStartTokens.keys()) {
      recordingStartTokens.set(
        roomId,
        recordingStartTokens.get(roomId) + 1
      );
    }

    // 4. 清空尚未执行的任务
    transcodeQueue.length = 0;

    // 将尚未执行的切片任务标记为失败
    for (const task of clipQueue.splice(0)) {
      task.status = 'failed';
      task.error = '服务正在关闭，任务未执行';
      task.finishedAt = Date.now();
    }

    // 5. 停止正在录制的进程
    const recordingList = [
      ...recordingProcs.values()
    ];

    for (const rec of recordingList) {
      try {
        if (process.platform === 'win32' && rec.proc.stdin) {
          rec.proc.stdin.write('q');
        } else {
          rec.proc.kill('SIGINT');
        }
      } catch (e) {}
    }

    // 6. 取消正在执行的转码
    const transcodeList = [
      ...transcodeProcesses.entries()
    ];

    for (const [sourceKey, proc] of transcodeList) {
      cancelledTranscodes.add(sourceKey);

      try {
        if (
          proc.exitCode === null &&
          proc.signalCode === null
        ) {
          proc.kill();
        }
      } catch (e) {}
    }

    // 7. 停止正在执行的切片
    const clipList = [
      ...clipProcesses.values()
    ];

    for (const proc of clipList) {
      try {
        if (
          proc.exitCode === null &&
          proc.signalCode === null
        ) {
          proc.kill();
        }
      } catch (e) {}
    }

    // 8. 等待录制、转码、切片进程退出
    const allProcesses = [
      ...recordingList.map(x => x.proc),
      ...transcodeList.map(x => x[1]),
      ...clipList
    ];

    const uniqueProcesses = [
      ...new Set(allProcesses)
    ];

    for (const proc of uniqueProcesses) {
      let exited = await waitForProcessExit(
        proc,
        10000
      );

      if (!exited) {
        log(
          'WARN',
          '子进程 10 秒内未退出，尝试强制终止'
        );

        try {
          if (
            proc.exitCode === null &&
            proc.signalCode === null
          ) {
            proc.kill('SIGKILL');
          }
        } catch (e) {}

        exited = await waitForProcessExit(
          proc,
          5000
        );
      }

      if (!exited) {
        log(
          'ERROR',
          '子进程无法确认退出，服务将继续关闭'
        );
      }
    }

    // 9. 关闭 HTTP 服务
    if (httpServer) {
      await new Promise(resolve => {
        const timer = setTimeout(() => {
          log('WARN', 'HTTP 服务 10 秒内未完全关闭，强制断开剩余连接');
          try { httpServer.closeAllConnections(); } catch (e) {}
          resolve();
        }, 10000);

        httpServer.close(() => {
          clearTimeout(timer);
          log('INFO', 'HTTP 服务已关闭');
          resolve();
        });

        // Node 18.2+ 支持主动断开空闲连接，加速关闭
        try { httpServer.closeIdleConnections(); } catch (e) {}
      });

      httpServer = null;
    }

    // 10. 等待日志写入完成
    log('INFO', '服务关闭完成');

    await closeLog();

    process.exit(0);
  })();

  return shutdownPromise;
}

// 监听退出信号
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 未捕获异常：记日志后优雅关闭，避免子进程变孤儿
process.on('uncaughtException', e => {
  log('ERROR', `未捕获异常：${e && e.stack || e}`);
  shutdown('UNCAUGHT_EXCEPTION');
});

// 未处理的 Promise 拒绝：只记日志，不退出（避免非致命错误导致服务中断）
process.on('unhandledRejection', e => {
  log('ERROR', `未处理 Promise 拒绝：${e && e.stack || e}`);
});

// 仅直接运行文件时启动，作为模块引用时不自动启动
if (require.main === module) {
  startServer();
}