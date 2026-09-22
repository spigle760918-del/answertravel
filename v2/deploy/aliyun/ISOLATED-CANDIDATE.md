# AnswerTravel V2 isolated deployment candidate

This candidate is designed to run beside the current production API. It does not replace the current API, start a worker, enqueue jobs, call DeepSeek, or change public traffic.

## Isolation contract

- Compose project: `answertravel-v2-candidate`.
- Container: `answertravel-v2-candidate-api-candidate-1`.
- Existing internal network: `aliyun_answertravel`.
- Existing proxy network: `answertravel_proxy`.
- Candidate proxy address: `172.30.0.11`; the current API remains at `172.30.0.10`.
- Candidate session cookie uses a distinct name.
- The candidate uses the existing runtime database role and only read-oriented product routes. No worker is included.

Before use, verify that `172.30.0.11` is not allocated. A conflict is a stop condition.

## Required gates

1. Verify the archive SHA-256 against `CANDIDATE-MANIFEST.json` and confirm the source archive is present under `web/public/`.
2. Back up PostgreSQL and Redis and retain their checksums. Do not use `docker compose down -v`.
3. Run migration dry audit against the current migration ledger. Any historical checksum mismatch is a stop condition.
4. Apply only new migrations through the migrator role, then verify `0025_invite_auth.sql` and `0026_competitor_scope_versions.sql` are recorded.
5. Apply `grant-candidate-runtime.sql` using the migrator/owner connection and verify the runtime privileges explicitly.
6. Build the candidate image with the version from the manifest. Do not retag it as the current production image.
7. Start only `api-candidate`; confirm the current API and worker remain running and unchanged.
8. Test health, login failure, invited login, logout, expiry/revocation and cross-tenant blocking through the isolated hostname.
9. Verify `/UPSTREAM.md`, `/AGPL-3.0.txt`, and `/answertravel-v2-frontend-source.tar.gz` are publicly readable from the candidate hostname.
10. Obtain a separate Gate E for the public candidate. Formal traffic switching requires another explicit authorization.

## Build and start outline

```sh
export CANDIDATE_VERSION='REPLACE_FROM_MANIFEST'
cp deploy/aliyun/env.candidate.example deploy/aliyun/.env.candidate
# Replace every REPLACE_* value without printing secrets.
docker network inspect aliyun_answertravel
docker network inspect answertravel_proxy
docker compose --env-file deploy/aliyun/.env.candidate -f deploy/aliyun/compose.isolated-candidate.yml config --quiet
docker compose --env-file deploy/aliyun/.env.candidate -f deploy/aliyun/compose.isolated-candidate.yml build api-candidate
docker compose --env-file deploy/aliyun/.env.candidate -f deploy/aliyun/compose.isolated-candidate.yml up -d --no-deps api-candidate
```

Create the first invited user only after the dry run is reviewed. Supply secrets through the process environment and do not paste them into shell history or logs. Execution additionally requires `INVITE_USER_AUTHORIZATION=answertravel-invite-user-v1` and `--execute`; the script never prints the password and does not silently replace an existing password or role.

## Rollback

Stop and remove only the candidate container and candidate Compose project. Do not remove shared networks, production containers, volumes or database rows. Database migrations are forward-only additive changes; restore only from the verified pre-migration backup if a database rollback is explicitly approved.
