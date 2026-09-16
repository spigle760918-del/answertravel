#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

project_dir="${1:-/www/wwwroot/answertravel-v2/deploy/aliyun}"
compose_file="$project_dir/compose.production.yml"
env_file="$project_dir/.env.production"
backup_root="/www/backup/answertravel-v2"
stamp="$(date '+%Y%m%dT%H%M%S%z')"
backup_dir="$backup_root/$stamp"
pg_dump_file="$backup_dir/postgres.dump"
redis_dump_file="$backup_dir/redis-dump.rdb"
manifest_file="$backup_dir/manifest.json"
pg_restore_container="answertravel-pg-restore-$stamp"
pg_restore_volume="answertravel-pg-restore-$stamp"
redis_restore_container="answertravel-redis-restore-$stamp"

if [[ ! -f "$compose_file" || ! -f "$env_file" ]]; then
  echo "BACKUP_RESTORE_GATE=STOP"
  echo "Production Compose or environment file was not found in $project_dir" >&2
  exit 1
fi

read_env() {
  local key="$1"
  grep -m1 "^${key}=" "$env_file" | cut -d= -f2- | tr -d '\r'
}

db_name="$(read_env POSTGRES_DB)"
admin_user="$(read_env POSTGRES_ADMIN_USER)"
admin_pass="$(read_env POSTGRES_ADMIN_PASSWORD)"

if [[ -z "$db_name" || -z "$admin_user" || -z "$admin_pass" ]]; then
  echo "BACKUP_RESTORE_GATE=STOP"
  echo "PostgreSQL backup settings are incomplete." >&2
  exit 1
fi

compose=(docker compose --env-file "$env_file" -f "$compose_file")

cleanup() {
  docker rm -f "$pg_restore_container" >/dev/null 2>&1 || true
  docker rm -f "$redis_restore_container" >/dev/null 2>&1 || true
  docker volume rm "$pg_restore_volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

mkdir -p "$backup_dir"
chmod 700 "$backup_root" "$backup_dir"

postgres_health="$("${compose[@]}" ps --format json postgres | tr -d '\r')"
redis_health="$("${compose[@]}" ps --format json redis | tr -d '\r')"
if [[ "$postgres_health" != *'"Health":"healthy"'* || "$redis_health" != *'"Health":"healthy"'* ]]; then
  echo "BACKUP_RESTORE_GATE=STOP"
  echo "PostgreSQL and Redis must both be healthy before backup." >&2
  exit 1
fi

production_counts="$("${compose[@]}" exec -T -e PGPASSWORD="$admin_pass" postgres \
  psql -U "$admin_user" -d "$db_name" -tAc \
  "select json_build_object('tenants',(select count(*) from tenants),'brand_truth_cards',(select count(*) from brand_truth_cards),'question_panels',(select count(*) from question_panels),'observation_plans',(select count(*) from observation_plans),'raw_answers',(select count(*) from raw_answers),'monitoring_schedules',(select count(*) from monitoring_schedules))::text" \
  | tr -d '[:space:]')"

"${compose[@]}" exec -T -e PGPASSWORD="$admin_pass" postgres \
  pg_dump -U "$admin_user" -d "$db_name" \
  --format=custom --no-owner --no-privileges > "$pg_dump_file"

redis_container_id="$("${compose[@]}" ps -q redis)"
production_redis_keys="$("${compose[@]}" exec -T redis redis-cli -n 2 DBSIZE | tr -d '\r')"
"${compose[@]}" exec -T redis redis-cli BGSAVE >/dev/null

for _ in $(seq 1 60); do
  persistence="$("${compose[@]}" exec -T redis redis-cli INFO persistence | tr -d '\r')"
  if [[ "$persistence" == *'rdb_bgsave_in_progress:0'* && "$persistence" == *'rdb_last_bgsave_status:ok'* ]]; then
    break
  fi
  sleep 1
done

persistence="$("${compose[@]}" exec -T redis redis-cli INFO persistence | tr -d '\r')"
if [[ "$persistence" != *'rdb_bgsave_in_progress:0'* || "$persistence" != *'rdb_last_bgsave_status:ok'* ]]; then
  echo "BACKUP_RESTORE_GATE=STOP"
  echo "Redis snapshot did not complete successfully." >&2
  exit 1
fi

docker cp "$redis_container_id:/data/dump.rdb" "$redis_dump_file" >/dev/null
chmod 600 "$pg_dump_file" "$redis_dump_file"

pg_sha256="$(sha256sum "$pg_dump_file" | awk '{print $1}')"
redis_sha256="$(sha256sum "$redis_dump_file" | awk '{print $1}')"

restore_pass="$(openssl rand -hex 24)"
docker volume create "$pg_restore_volume" >/dev/null
docker run -d \
  --name "$pg_restore_container" \
  -e POSTGRES_PASSWORD="$restore_pass" \
  -e POSTGRES_DB="$db_name" \
  -v "$pg_restore_volume:/var/lib/postgresql/data" \
  postgres:16.4 >/dev/null

for _ in $(seq 1 60); do
  if docker exec -e PGPASSWORD="$restore_pass" "$pg_restore_container" \
    pg_isready -U postgres -d "$db_name" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec -e PGPASSWORD="$restore_pass" "$pg_restore_container" \
  pg_isready -U postgres -d "$db_name" >/dev/null

docker exec -i -e PGPASSWORD="$restore_pass" "$pg_restore_container" \
  pg_restore -U postgres -d "$db_name" --no-owner --no-privileges < "$pg_dump_file"

restored_counts="$(docker exec -e PGPASSWORD="$restore_pass" "$pg_restore_container" \
  psql -U postgres -d "$db_name" -tAc \
  "select json_build_object('tenants',(select count(*) from tenants),'brand_truth_cards',(select count(*) from brand_truth_cards),'question_panels',(select count(*) from question_panels),'observation_plans',(select count(*) from observation_plans),'raw_answers',(select count(*) from raw_answers),'monitoring_schedules',(select count(*) from monitoring_schedules))::text" \
  | tr -d '[:space:]')"

if [[ "$production_counts" != "$restored_counts" ]]; then
  echo "BACKUP_RESTORE_GATE=STOP"
  echo "PostgreSQL restored counts differ from production counts." >&2
  exit 1
fi

docker create --name "$redis_restore_container" redis:7.2-alpine \
  redis-server --appendonly no >/dev/null
docker cp "$redis_dump_file" "$redis_restore_container:/data/dump.rdb" >/dev/null
docker start "$redis_restore_container" >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$redis_restore_container" redis-cli ping 2>/dev/null | grep -q '^PONG$'; then
    break
  fi
  sleep 1
done

restored_redis_keys="$(docker exec "$redis_restore_container" redis-cli -n 2 DBSIZE | tr -d '\r')"
if [[ "$production_redis_keys" != "$restored_redis_keys" ]]; then
  echo "BACKUP_RESTORE_GATE=STOP"
  echo "Redis restored key count differs from production." >&2
  exit 1
fi

cat > "$manifest_file" <<EOF
{
  "createdAt": "$(date --iso-8601=seconds)",
  "postgresSha256": "$pg_sha256",
  "redisSha256": "$redis_sha256",
  "productionCounts": $production_counts,
  "restoredCounts": $restored_counts,
  "productionRedisDb2Keys": $production_redis_keys,
  "restoredRedisDb2Keys": $restored_redis_keys,
  "productionVolumesModified": false,
  "deepseekCalled": false
}
EOF
chmod 600 "$manifest_file"

echo "BACKUP_RESTORE_GATE=PASS"
echo "BackupDir=$backup_dir"
echo "PostgresSHA256=$pg_sha256"
echo "RedisSHA256=$redis_sha256"
echo "ProductionCounts=$production_counts"
echo "RestoredCounts=$restored_counts"
echo "RedisDB2Keys=$production_redis_keys"
echo "Temporary restore containers and volume will now be removed; backup files are retained."
