# Render deployment

## Provisioning

1. Create a Render account and connect GitHub repository `EldadIfergan/LittleDreams`.
2. Create a Blueprint from `render.yaml`. Review the paid plan before deployment: Starter service and a 5 GB persistent disk. Expected base cost is $8.25/month at the reviewed rates, excluding taxes and usage overages.
3. Confirm the data disk is mounted at `/var/data`; never deploy this app with ephemeral storage alone.
4. After deployment, check `/healthz`, create a real account, add an event and attachment, then restart the service and verify the same account, event and attachment remain available.
5. Test an invitation from another browser and device over HTTPS, including family comments and blocked editing.

Local demo accounts and uploads are deliberately excluded from the image. The online service starts empty. GitHub contains code only, not album contents or passwords.

## Backups and recovery

With `BACKUP_ENABLED=1`, the server creates a consistent SQLite backup on startup and every 24 hours, retaining the latest 14 copies in `/var/data/backups`. These are database backups only. Media remains in `/var/data/uploads`. Render also takes daily disk snapshots; see https://render.com/docs/disks.

The SQLite copies are on the SAME disk: they protect against database mistakes, not loss of the whole disk or account. Before relying on this as the only copy of family memories, arrange an encrypted copy of both backups and uploads outside Render. Keep original media too. An off-site backup destination is not yet configured.

To recover, stop writes and the service, preserve the current data directory, restore a verified SQLite backup to `/var/data/album.sqlite` together with its media files, and restart. Do not blindly restore a live database disk snapshot; Render warns that database snapshots can be inconsistent. Rehearse restoration with a separate data directory before replacing live data.

## Current limits

One service instance only, 20 MB per event, 5 files per event, no password recovery or email verification yet. File type checks currently rely on declared MIME type; production hardening and a full deployment smoke test remain necessary. No claim of zero downtime or guaranteed preservation is made. Manual deployments are configured to avoid unexpected changes to the live family site.
