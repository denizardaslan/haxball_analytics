# Live VPS Deployment

Use this folder when a local code change needs to be applied to the live Haxball room.

## Required Values

Set these in your shell before running `update-live.sh`:

```bash
export HAXBALL_VPS_HOST="user@server-ip-or-host"
export HAXBALL_VPS_PATH="/path/to/haxball_analytics"
```

Choose one restart style:

```bash
# PM2 example
export HAXBALL_VPS_RESTART_COMMAND="pm2 restart haxball-analytics"

# systemd example
export HAXBALL_VPS_RESTART_COMMAND="sudo systemctl restart haxball-analytics"
```

## Apply Current Project To Live

```bash
./deploy/update-live.sh
```

The script syncs source, Bruin assets, public dashboard files, config examples, package files, and docs to the VPS. It does not sync `.env`, `data/`, `logs/`, `.venv/`, `node_modules/`, or `dist/`.

On the VPS it runs:

```bash
npm install
npm run build
npm run bruin:validate
```

Then it runs `HAXBALL_VPS_RESTART_COMMAND`.

## Bruin Chat Check

After restart, test in the live Haxball room:

```text
!bruin top players
!bruin xg
!bruin pipeline
```

If the room does not answer, check live process logs for:

```text
[BruinChat] Command received
[BruinChat] <player>: <question> -> <intent>
```

If those lines are missing, the live process was not restarted with the updated code.
