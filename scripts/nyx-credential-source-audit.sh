#!/usr/bin/env bash
# Read-only, owner-operated Heroku -> PostgreSQL credential-source audit.
# Requires heroku jq python3 psql. Never prints URLs or secret values.
set -euo pipefail
umask 077
APP="${APP:-dev-nest-nyx}"
for bin in heroku jq python3 psql; do
  command -v "$bin" >/dev/null || { echo "Missing: $bin" >&2; exit 2; }
done
config="$(heroku config --app "$APP" --json)"
printf 'app=%s\n' "$APP"
printf '%s' "$config" | jq -r 'keys[] | select(test("RCLONE|MEGA|DRIVE|CREDENTIAL|VAULT|ENCRYPT|DATABASE|NYX_MULTIUSER|NYX_DEPLOYMENT";"i")) | "env_key="+.'
printf '%s' "$config" | jq -r '"legacy_private_config_present="+([.RCLONE_CONFIG_B64,.RCLONE_CONFIG_PATH,.RCLONE_CONFIG,.NYX_SHARED_ROOTS_JSON] | any(. != null and . != "") | tostring)'
url="$(printf '%s' "$config" | jq -er '.DATABASE_URL | select(type=="string" and startswith("postgres"))')"
unset config
# URL goes to Python via stdin; it never appears as process arguments.
mapfile -d '' -t parts < <(printf '%s' "$url" | python3 -c 'import sys,urllib.parse as u
p=u.urlsplit(sys.stdin.read())
if p.scheme not in ("postgres","postgresql") or not p.hostname or not p.username: raise SystemExit(1)
for v in (p.hostname,str(p.port or 5432),u.unquote(p.username),u.unquote(p.password or ""),p.path.lstrip("/") or "neondb"):
 sys.stdout.buffer.write(v.encode()+b"\0")')
test "${#parts[@]}" -eq 5 || { echo "Cannot parse DATABASE_URL" >&2; exit 3; }
export PGHOST="${parts[0]}" PGPORT="${parts[1]}" PGUSER="${parts[2]}" PGPASSWORD="${parts[3]}" PGDATABASE="${parts[4]}" PGSSLMODE=require
unset parts url
psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT 'db='||current_database(), 'v2='||(to_regclass('public.nyx_rclone_tenant_credentials_v2') IS NOT NULL)::text, 'legacy='||(to_regclass('public.nyx_rclone_credential_vault') IS NOT NULL)::text;"
if test "$(psql -X -Atqc "SELECT to_regclass('public.nyx_rclone_tenant_credentials_v2') IS NOT NULL")" = t; then
  psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT 'v2_count='||provider||':'||state||':'||count(*) FROM public.nyx_rclone_tenant_credentials_v2 GROUP BY provider,state ORDER BY provider,state;"
fi
if test "$(psql -X -Atqc "SELECT to_regclass('public.nyx_connector_connections') IS NOT NULL")" = t; then
  psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT 'connections='||provider||':'||status||':'||count(*) FROM public.nyx_connector_connections GROUP BY provider,status ORDER BY provider,status;"
fi
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
echo READ_ONLY_COMPLETE
