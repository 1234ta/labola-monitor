import { loadEnvFile } from './env.js';
import { runMonitorCycle } from './monitor.js';

loadEnvFile();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(`LaBOLA 個サル監視チェック開始 (${dryRun ? 'DRY RUN' : '本番'})...`);
  const result = await runMonitorCycle({ dryRun });
  console.log(`チェック完了: ${result.checkedAt}`);
  console.log(`一致イベント数: ${result.matchedCount}件 / 通知トリガー: ${result.alertsCount}件`);

  for (const ev of result.events) {
    const hol = ev.holidayName ? `[${ev.holidayName}]` : '';
    const count = ev.booked !== null ? `${ev.booked}/${ev.capacity} (残り${ev.remaining})` : ev.status;
    console.log(` - ${ev.date}(${ev.dayOfWeek})${hol} ${ev.startTime}-${ev.endTime} | ${count} | ${ev.shopName}`);
  }

  if (result.errors.length > 0) {
    console.error('エラー:', result.errors);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
