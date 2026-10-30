# Public demonstration link

This project can run behind a temporary HTTPS Cloudflare Quick Tunnel while the Windows computer stays on. The Next.js production server keeps using the local SQLite database and existing CampusOps logins. The project is not uploaded as a static website or moved to another database.

The URL changes when the tunnel is restarted and stops working when its process stops. Cloudflare describes Quick Tunnels as a testing/development service with no uptime guarantee, a limit of 200 concurrent requests, and no Server-Sent Events support. CampusOps uses ordinary HTTP polling for the transport demo. See the [official Quick Tunnel guide](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## Prepare once

From the CampusOps project folder in PowerShell, download the reviewed Windows amd64 binary from Cloudflare's official GitHub release. The launcher checks its SHA-256 before executing it. The pinned release and checksum come from [Cloudflare 2026.10.3](https://github.com/cloudflare/cloudflared/releases/tag/2026.10.3).

```powershell
New-Item -ItemType Directory -Path .tools -Force
Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/download/2026.10.3/cloudflared-windows-amd64.exe' -OutFile '.tools/cloudflared.exe'
Get-FileHash -LiteralPath '.tools/cloudflared.exe' -Algorithm SHA256
```

The expected SHA-256 is:

```text
76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2
```

`.tools/` and `.public-demo/` should be ignored by Git. The first contains the downloaded executable; the second contains local process logs and the temporary URL. Do not upload the database, backups, `.env`, or credentials.

## Start the public demo

Run the normal checks and production build first. Start the launcher only after the module is ready to show:

```powershell
npm.cmd run build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\public-demo.ps1
```

`ExecutionPolicy Bypass` applies only to this PowerShell invocation; it does not change the computer's saved policy. The launcher uses port 3001 by default and refuses to start if that port is already occupied. You can use another unused port with `-Port 3002`.

When ready, the script prints `PUBLIC_DEMO_URL=https://...trycloudflare.com`. Open that HTTPS address, sign in with an existing CampusOps account, and share the address for the review. The public address opens the login screen; it does not grant access without an account. Keep the computer awake and keep this terminal running.

The launcher sets `APP_ORIGIN` to the exact generated HTTPS URL for the production server process. This preserves same-origin mutation checks and Secure session cookies. It does not modify `.env`, reset passwords, revoke existing sessions, or alter the development server. The public site's host has its own browser cookie, so sign in again there.

To stop the demo, press **Ctrl+C in the launcher terminal**. It stops only the server and tunnel that it launched. Start it again for a new public URL. Do not rebuild the production `.next` directory while the public server is running.

## Verification and troubleshooting

Before sharing the link, confirm the public login page opens and signed-out `/api/dashboard` and `/api/transport` requests return 401. Then sign in and check the dashboard's Transportation view and a simulated rescue.

If Cloudflare is blocked by the network, the tunnel may fail to connect; inspect the log folder printed by the launcher. The script uses HTTP/2 for the tunnel connection. No router port-forwarding or inbound firewall port is required. The app itself binds only to `127.0.0.1`.

If the app reports an origin error after a restart, use the newly printed HTTPS URL instead of the previous one. If port 3001 is occupied, stop the prior launcher or choose an unused port; do not stop an unrelated process.

This is the requested temporary public demonstration, not permanent hosting. A future permanent deployment needs a stable host and persistent storage for SQLite, or a separately reviewed database migration.
