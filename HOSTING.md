**Hosting Guide**
This app is ready for beta hosting on a VPS with:
- `Node.js 20`
- `PM2`
- `Nginx`
- `FFmpeg`
- `HTTPS`

**Recommended Stack**
- App server: Ubuntu 22.04 VPS
- Process manager: PM2
- Reverse proxy: Nginx
- Media: S3
- Database today: SQLite beta
- Database later: PostgreSQL on RDS

**1. Install System Packages**
```bash
sudo apt update
sudo apt install -y nginx ffmpeg git curl build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

**2. Upload The App**
```bash
git clone YOUR_REPO_URL vibeai-ad-studio
cd vibeai-ad-studio
npm install
npm run build
```

**3. Configure Production Env**
Copy [`.env.production.example`](/C:/Users/rushi/Downloads/vibeai-ad-studio/.env.production.example) to `.env.local` on the server and fill in the real values.

Minimum values:
```env
NODE_ENV=production
PORT=3005
APP_URL=https://yourdomain.com
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
ALLOW_INSECURE_LOCAL_AUTH=false
DEMO_LOGIN_EMAIL=demo@example.com
GEMINI_API_KEY=...
ELEVENLABS_API_KEY=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-south-1
S3_BUCKET=vibeai-media-rushikesh
```

**4. Start With PM2**
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

**5. Configure Nginx**
Copy [nginx.vibeai.conf](/C:/Users/rushi/Downloads/vibeai-ad-studio/deploy/nginx.vibeai.conf) to your Nginx sites directory and replace the domain.

Example:
```bash
sudo cp deploy/nginx.vibeai.conf /etc/nginx/sites-available/vibeai
sudo ln -s /etc/nginx/sites-available/vibeai /etc/nginx/sites-enabled/vibeai
sudo nginx -t
sudo systemctl restart nginx
```

**6. Add HTTPS**
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

**7. Health Check**
After deploy:
- open `https://yourdomain.com`
- verify `https://yourdomain.com/api/health`

Expected:
- app responds
- `storage.s3.configured` is `true`

**8. Backups**
Until PostgreSQL migration is done, back up:
- `vibe_studio.db`
- `public/uploads`

Example cron backup approach:
```bash
tar -czf backup-$(date +%F).tar.gz vibe_studio.db public/uploads
```

**9. Before Public Launch**
- rotate AWS keys
- replace beta auth with real auth
- move DB to PostgreSQL
- add monitoring and alerts
- add regular automated backups

**Current Status**
This repo is ready for:
- beta/private hosting
- VPS deployment

This repo is not yet ideal for:
- high-scale public launch
- payment-led production without stronger auth and PostgreSQL
