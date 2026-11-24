#!/usr/bin/env node
/**
 * 当天签到完成状态判定（幂等保护）。
 *
 * 背景：主任务与补跑任务都会调用 src/run-daily.js。若 12:00 已全部签到成功，
 * 12:45 的补跑仍会重新启动浏览器、重新拉起客户端，既浪费又容易和主任务抢锁。
 * 这里根据 config.json 的启用平台 + data/results.jsonl 的当天结果判断是否还需要跑。
 *
 * 独立成模块，便于单独测试，也尽量少改动上游主流程。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 本地日期 YYYY-MM-DD */
export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** config.json 中启用的平台 id 列表 */
export function enabledPlatformIds(projectDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectDir, 'config.json'), 'utf8'));
    return Object.entries(cfg.platforms || {})
      .filter(([, v]) => v && v.enabled === true)
      .map(([id]) => id);
  } catch {
    return [];
  }
}

/** 指定日期里「真实签到成功」的结果（与 runner.js 的 alreadyDoneToday 口径一致） */
export function succeededOn(projectDir, date = todayKey()) {
  const file = path.join(projectDir, 'data', 'results.jsonl');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((r) => r && r.date === date && !r.dryRun && (r.status === 'success' || r.status === 'already'));
}

/** 当天尚未签到成功的平台 id；空数组表示全部完成 */
export function pendingPlatformIds(projectDir, date = todayKey()) {
  const wanted = enabledPlatformIds(projectDir);
  if (!wanted.length) return [];
  const done = new Set(succeededOn(projectDir, date).map((r) => r.id));
  return wanted.filter((id) => !done.has(id));
}

export function todayAllDone(projectDir, date = todayKey()) {
  return pendingPlatformIds(projectDir, date).length === 0;
}
