# Install this with the cron job:
# 0   11 *   *   *     bash /home/yang/bounce/tools/gc-stats.bash &> /tmp/gc-stats.log

# Compress files
ls -1 cli-stats-*.log | tac | tail -n +3 | xargs gzip -9
# Delete files older than 30d
ls -1 -t cli-stats-*| tail -n +30 | xargs rm --