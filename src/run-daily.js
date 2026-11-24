#!/usr/bin/env node
/**
 * 每日执行入口（跨平台）。
 *
 * macOS: 由 launchd 调用（src/schedule.js 安装 plist 指向本文件）
 * Windows: 由计划任务（schtasks）调用
 *
 * 职责：单实例锁 → 随机延迟 → 执行签到 → 写日志 → 返回退出码
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { isWindows } from './platform.js';
import { todayAllDone, pendingPlatformIds } from './checkin-state.js';

const PROJECT_DIR = process.cwd();
const LOG_DIR = path.join(PROJECT_DIR, 'data', 'log');
const LOG_FILE = path.join(LOG_DIR, 'launchd.log');
const LOCK_DIR = path.join(PROJECT_DIR, 'data', '.run.lock');

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function log(msg) {
  const line = `${stamp()} [run-daily] ${msg}`;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch {
    /* 日志失败不影响主流程 */
  }
  console.log(line);
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function acquireLock() {
  // 一次完整签到 = 最多 5 分钟随机延迟 + 实测约 2 分钟（极端超时上限约 10 分钟）。
  // 锁目录的 mtime 是「上次启动时间」，进程被休眠/注销强杀时 finally 不会执行，
  // 原来 6 小时的陈旧阈值会让残留锁挡掉当天所有补跑（11/9 漏签即由此放大）。
  // 25 分钟足够正常执行跑完，又能在 13:00 补跑前把残留锁清掉接管。
  const staleMs = 25 * 60 * 1000;
  try {
    fs.mkdirSync(LOCK_DIR, { recursive: false });
    return true;
  } catch {
    try {
      const st = fs.statSync(LOCK_DIR);
      if (Date.now() - st.mtimeMs > staleMs) {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
        fs.mkdirSync(LOCK_DIR, { recursive: false });
        return true;
      }
    } catch {
      /* 忽略 */
    }
    return false;
  }
}

function releaseLock() {
  try {
    fs.rmSync(LOCK_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 幂等保护：当天所有启用平台都已签到成功时，主跑和补跑都不再重复启动浏览器。
  // 若只成功了一部分，仍继续执行，由 index.js 的 --skip-if-done 只补未完成的平台。
  if (todayAllDone(PROJECT_DIR)) {
    log('今日各平台均已签到成功，跳过本次执行');
    return 0;
  }
  log(`今日待补平台: ${pendingPlatformIds(PROJECT_DIR).join('、')}`);

  if (!acquireLock()) {
    log('已有实例在运行，本次跳过');
    return 0;
  }

  try {
    const cfg = readConfig();
    const delayMin = process.env.CHECKIN_NO_DELAY === '1' ? 0 : Number(cfg?.schedule?.randomDelayMinutes ?? 0);
    if (delayMin > 0) {
      const waitMs = Math.floor(Math.random() * delayMin * 60 * 1000);
      log(`随机等待 ${Math.round(waitMs / 1000)}s 后开始（上限 ${delayMin} 分钟）`);
      await sleep(waitMs);
    }

    log(`开始执行签到（${isWindows ? 'Windows' : 'macOS'}）`);
    const code = await new Promise((resolve) => {
      const args = [path.join(PROJECT_DIR, 'src', 'index.js'), 'run', '--skip-if-done', '--quiet'];
      if (process.env.CHECKIN_DRY_RUN === '1' || process.argv.includes('--dry-run')) args.push('--dry-run');
      if (process.env.CHECKIN_ONLY) args.push(`--only=${process.env.CHECKIN_ONLY}`);
      const child = spawn(process.execPath, args, {
        cwd: PROJECT_DIR,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (b) => process.stdout.write(b));
      child.stderr.on('data', (b) => process.stderr.write(b));
      child.on('close', (c) => resolve(c ?? 1));
      child.on('error', (e) => {
        log(`启动失败: ${e.message}`);
        resolve(1);
      });
    });
    log(`结束，退出码 ${code}`);
    return code;
  } finally {
    releaseLock();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    log(`未捕获异常: ${e?.message || e}`);
    process.exit(1);
  });
