# Aegis Quant V2.4 - Oracle ARM Ubuntu 24.04 Deployment Guide

This guide details the secure deployment of the Aegis Quant system onto an Oracle Cloud Infrastructure (OCI) ARM instance running Ubuntu 24.04.

## 1. Prerequisites & Instance Setup
- **OS**: Ubuntu 24.04 LTS (aarch64)
- **Node.js**: v20 or v22 (LTS)
- **Security List (Oracle Console)**:
  - Ingress TCP 80 (HTTP for Let's Encrypt / redirect)
  - Ingress TCP 443 (HTTPS for Aegis dashboard)
  - Ingress TCP 22 (SSH - Restricted to your management IP)
  - **CRITICAL**: Do NOT expose port 3000 to the public internet.

## 2. Environment Preparation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
```

## 3. Database (sqlite3 arm64 validation)
The system uses native sqlite3 bindings for high performance. On ARM64, the binary must be built or fetched correctly.

```bash
# Navigate to app directory
cd /path/to/aegis-quant

# Install dependencies and build sqlite3 for arm64
npm ci
```
If sqlite3 fails to build native bindings, the system will securely degrade to a JSON fallback mode, but performance will be severely degraded. Verify native bindings:
```bash
npx tsx scripts/auth-doctor.ts
# Ensure "Native sqlite3 Package Supported: YES"
```

## 4. Build System

```bash
# Build the React frontend and bundle the backend
npm run build
```

## 5. Security & Configuration
Set up the `.env` file according to `.env.example`.

**Crucial Steps:**
1. Execute `npm run sync-admin-password -- --username admin --confirm` locally to initialize password if desired, though normally `.env` takes precedence on boot for initial setup.
2. After first login and TOTP setup, **REMOVE** `BOOTSTRAP_ADMIN_TOTP_SECRET` and set `ADMIN_TOTP_SYNC_ON_BOOT=false` in `.env` to prevent credential overwrite attacks.

## 6. Systemd Service Setup
Do not run the app in `tmux` or `screen`. Use `systemd`.

```ini
# /etc/systemd/system/aegis.service
[Unit]
Description=Aegis Quant Platform
After=network.target

[Service]
Environment=NODE_ENV=production
Type=simple
User=ubuntu
WorkingDirectory=/path/to/aegis-quant
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable aegis
sudo systemctl start aegis
```

## 7. Nginx & Reverse Proxy
Install Nginx and certbot for HTTPS. The app requires HTTPS to secure cookies and TOTP seeds.

```bash
sudo apt install nginx certbot python3-certbot-nginx -y

# Configure Nginx (/etc/nginx/sites-available/aegis)
# Proxy pass to http://127.0.0.1:3000
```

## 8. UFW Firewall Setup

```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow from <YOUR_IP> to any port 22
sudo ufw enable
```

## 9. Backup Strategy
- Create an automated cron job to backup the `data/` directory (which contains `aegis.db` and secure logs).
- Example: `tar -czvf /backup/aegis_data_$(date +%F).tar.gz /path/to/aegis-quant/data`
