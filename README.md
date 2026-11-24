# zaoba Windows 本地加固补丁

用于 BorisSun0424-boop/zaoba 在 Windows 上的本地加固，避免上游更新覆盖。
本地安装目录：D:\zaoba

## 包含的文件

| 文件 | 作用 |
| --- | --- |
| src/run-daily.js | 增加当日签到幂等判断；陈旧锁阈值从 6 小时改为 25 分钟，避免崩溃残留锁挡住补跑 |
| src/checkin-state.js | 新增：根据 config.json 启用平台 + results.jsonl 当天结果判断是否已签完 |
| scripts/bootstrap.ps1 | 修复 Windows 脚本 5.1 读中文 JSON 的 BOM/编码问题，配置写入改为无 BOM UTF-8 |
| scripts/install-service.ps1 | 加 UTF-8 BOM，修复 Windows 脚本 5.1 误读中文注释导致脚本失败 |

## 背景

2026-11-09 漏签：主任务错过后补触发、进程在随机等待期被休眠杀掉，残留锁 + 6 小时陈旧阈值让补跑无法接管。
修复后调度：主跑 12:00，补跑 13:00；全部成功后补跑在入口处幂等跳过（0.1 秒退出，不启动浏览器）。

## 应用方法

覆盖上游仓库同名文件即可。run-daily.js 需与 checkin-state.js 一起放置。
注意：上游更新可能改动 run-daily.js，届时重新应用本补丁。
