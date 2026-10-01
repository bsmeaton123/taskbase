# Running taskbase on a Hostinger VPS

About 30 minutes, once. You end up with the app on `https://tasks.yourcompany.com`, HTTPS
certificates that renew themselves, and nightly backups.

## 1. The server

- **Plan**: KVM 2 (2 CPU, 8 GB) is comfortable. KVM 1 (1 CPU, 4 GB) runs it fine for a team,
  but add swap (step 3) or the build can run out of memory.
- **OS**: pick the **Ubuntu 24.04 with Docker** template in hPanel.
- **Firewall** (hPanel → VPS → Security → Firewall): allow only **22** (SSH), **80** and
  **443**. Use this rather than `ufw` on the server: ports published by Docker skip `ufw`,
  but Hostinger's firewall sits in front of the whole server.
- **SSH**: add your SSH key in hPanel, then turn off password logins
  (`PasswordAuthentication no` in `/etc/ssh/sshd_config`, then `systemctl restart ssh`).

## 2. The domain

Add a DNS **A record** for the name you want (e.g. `tasks`) pointing at the VPS IP address.
Wait until `ping tasks.yourcompany.com` shows that IP before starting the app, so Caddy can
get the certificate.

## 3. Swap (KVM 1 only)

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 4. The code and settings

Put the project in a **private** GitHub repository, then on the server:

```bash
git clone git@github.com:yourcompany/taskbase.git /opt/taskbase
cd /opt/taskbase
cp .env.example .env
nano .env
```

Fill in at least:

| Setting | Value |
| --- | --- |
| `DOMAIN` | `tasks.yourcompany.com` |
| `BETTER_AUTH_URL` | `https://tasks.yourcompany.com` |
| `POSTGRES_PASSWORD` | output of `openssl rand -hex 24` |
| `BETTER_AUTH_SECRET` | output of `openssl rand -base64 32` |
| `ADMIN_EMAIL` | your address (only it can create the first, admin account) |
| `ALLOWED_EMAIL_DOMAINS` | `yourcompany.com` |
| `SMTP_URL`, `EMAIL_FROM` | your email provider (for invites, the morning reminder, notifications and password resets) |
| `DEFAULT_TIMEZONE` | `Europe/London` (the morning reminder goes out at 8am local, see `REMINDER_HOUR`) |

Optional: `ANTHROPIC_API_KEY` (AI), `SLACK_ALERTS_WEBHOOK_URL` (error alerts),
`BACKUP_REMOTE` and its `RCLONE_CONFIG_...` lines (off-site backups).

Email: use a sending service or your Google Workspace / Microsoft 365 SMTP on port 465 or
587. Don't run a mail server on the VPS.

## 5. Start it

```bash
docker compose up -d --build
docker compose logs -f app caddy     # Ctrl+C to stop watching
```

Open `https://tasks.yourcompany.com` and create the admin account with `ADMIN_EMAIL`.
Then invite people from **People**.

## Updating

```bash
cd /opt/taskbase
git pull
docker compose up -d --build
```

Database changes are applied automatically when the app starts. It's offline for about
10 to 30 seconds while the new version starts. Take a Hostinger **snapshot** (hPanel →
VPS → Snapshots) before big updates, so you can roll the whole server back.

## Backups

| What | Where | How often |
| --- | --- | --- |
| Database dump | `/opt/taskbase/backups/db` on the server, last 14 days | Nightly at `BACKUP_TIME` |
| Database dumps and uploaded files | Your `BACKUP_REMOTE` (e.g. Cloudflare R2, Backblaze B2) | Nightly, if configured |
| The whole server | Hostinger's weekly backup | Weekly (hPanel) |

The server copy protects against mistakes in the app. The off-site copy protects against
losing the server, so set it up: Hostinger's weekly backup alone could lose up to a week.
Without `BACKUP_REMOTE`, uploaded files are only in the `uploads` volume (covered by
Hostinger's weekly snapshot, nothing nightly). Set a lifecycle rule on the bucket to expire
old objects; the off-site copy is never pruned by the app.

- Run a backup now: `docker compose exec backup backup.sh now`
- Check they're happening: `ls -lh backups/db` and `docker compose logs backup`
- Restore the database: `deploy/restore.sh backups/db/<file>.dump` (it takes a safety
  backup of the current data first)
- Restore uploaded files from off-site:
  `docker compose run --rm --entrypoint sh -v taskbase_uploads:/restore backup -c 'rclone copy "$BACKUP_REMOTE/uploads" /restore'`

If `SLACK_ALERTS_WEBHOOK_URL` is set, a failed backup posts to Slack.

## Keeping an eye on it

- `https://tasks.yourcompany.com/api/health` returns `{"ok":true}` when the app and database
  are up. Point a free uptime monitor (UptimeRobot, Better Stack) at it to hear about outages.
- Server errors post to Slack when `SLACK_ALERTS_WEBHOOK_URL` is set.
- Logs: `docker compose logs --tail 200 app`. They're capped at 30 MB per service.
- Security updates for Ubuntu: `apt install unattended-upgrades` (on by default on most
  Hostinger images).
