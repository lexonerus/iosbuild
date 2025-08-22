## Deploy: HTTPS на своём домене

Ниже два варианта развертывания:

- Рекомендовано: VPS (например, sprintbox.ru). Полный контроль: systemd, Nginx, HTTPS, MIME для OTA.
- Альтернатива: shared-хостинг sprinthost.ru. Подойдёт только если тариф поддерживает постоянные Node.js-процессы и проксирование. Часто ограничен и не даёт настраивать Nginx/MIME — для OTA это критично.

Если нужна надёжность OTA-установок (.plist, itms-services) и контроль над обновлениями — выбирайте VPS (Sprintbox).

---

### 0) Предпосылки
- Домен: example.com (или subdomain.example.com)
- Открытые порты: 80/443 TCP
- Система: Ubuntu 22.04 LTS (в примере)

DNS: добавьте A-запись домена на IP сервера. Подождите применения (обычно до 5–30 минут).

---

## Вариант A (рекомендовано): Sprintbox (VPS)

### 1) Подготовка сервера
Подключитесь по SSH как root, создайте пользователя для приложения и установите зависимости:

```bash
adduser iosapp --gecos "" --disabled-password && passwd iosapp
usermod -aG sudo iosapp
apt update && apt upgrade -y
apt install -y nginx certbot python3-certbot-nginx sqlite3

# Node.js 20 LTS (NodeSource)
apt install -y ca-certificates curl gnupg
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
apt update && apt install -y nodejs

# Каталоги для кода и данных
mkdir -p /opt/iosappdistrib /var/lib/iosappdistrib /var/log/iosappdistrib
chown -R iosapp:iosapp /opt/iosappdistrib /var/lib/iosappdistrib /var/log/iosappdistrib
```

### 2) Деплой кода
Скопируйте проект на сервер (git clone или rsync/scp), затем:

```bash
sudo -u iosapp bash -lc '
  cd /opt/iosappdistrib
  npm ci || npm install
  # Прод база (SQLite): файл в общей директории данных
  echo "DATABASE_URL=file:/var/lib/iosappdistrib/prod.db" > .env
  echo "ADMIN_USER=admin" >> .env
  echo "ADMIN_PASS=change-me" >> .env
  npx prisma generate
  npx prisma migrate deploy
  npm run build
'
```

### 3) systemd-сервис
Создайте юнит `/etc/systemd/system/iosappdistrib.service`:

```ini
[Unit]
Description=iOSAppDistrib (Node + Fastify)
After=network.target

[Service]
User=iosapp
WorkingDirectory=/opt/iosappdistrib
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATABASE_URL=file:/var/lib/iosappdistrib/prod.db
Environment=ADMIN_USER=admin
Environment=ADMIN_PASS=change-me
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Примените и запустите:

```bash
systemctl daemon-reload
systemctl enable --now iosappdistrib
systemctl status iosappdistrib -n 50
```

### 4) Nginx + HTTPS
Базовый reverse-proxy (HTTP), чтобы Certbot смог проверить домен:

```bash
cat >/etc/nginx/sites-available/iosappdistrib.conf <<'NGINX'
server {
  listen 80;
  server_name your.domain.com;

  client_max_body_size 300m;

  location / {
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:3000;
  }
}
NGINX
ln -s /etc/nginx/sites-available/iosappdistrib.conf /etc/nginx/sites-enabled/iosappdistrib.conf
nginx -t && systemctl reload nginx
```

Выпустите сертификат Let’s Encrypt (автоматически добавит 443-конфиг):

```bash
certbot --nginx -d your.domain.com --agree-tos -m you@example.com --no-eff-email
```

Добавьте MIME-типы и лимит размера в HTTPS-сервер (443) — откройте созданный файл в `/etc/nginx/sites-enabled/` и убедитесь, что внутри блока `server { ... }` есть:

```nginx
client_max_body_size 300m;

# Для OTA и загрузки IPA
types {
  application/octet-stream ipa;
  application/xml plist;
}
```

Проверьте и перезапустите Nginx:

```bash
nginx -t && systemctl reload nginx
```

### 5) Проверки

```bash
curl -I https://your.domain.com/health
# Должно ответить 200 OK
```

Откройте `https://your.domain.com/public/` и загрузите `.ipa`.

### 6) Обновление версии

```bash
sudo -u iosapp bash -lc '
  cd /opt/iosappdistrib
  git pull || true
  npm ci || npm install
  npx prisma migrate deploy
  npm run build
'
systemctl restart iosappdistrib
```

### 7) Резервное копирование
- База (SQLite): `/var/lib/iosappdistrib/prod.db`
- Загруженные IPA: `src/uploads/` (по умолчанию в каталоге приложения; перенесите на диск данных по необходимости и укажите путь в коде)

---

## Вариант B: sprinthost.ru (shared)

Проверьте тариф: поддерживает ли он постоянные Node.js-приложения и управление проксированием. Если да:

- В панели включите HTTPS для домена (обычно Let’s Encrypt)
- Загрузите код (Git/SFTP), выполните `npm install && npm run build`
- Запустите Node-процесс (если есть встроенный менеджер процессов/PM2 в панели)
- Проксируйте домен к процессу (или используйте порт, предоставленный платформой)

Ограничения:
- Часто нет доступа к Nginx-конфигу, значит нельзя гарантировать `types` для `.ipa/.plist` и `client_max_body_size`
- OTA-установка может не работать стабильно без корректных MIME и большого лимита загрузки

Если возникают проблемы с MIME/размером или процесс завершает хостинг — переходите на VPS (Sprintbox).

---

## Примечания по безопасности
- Используйте `ADMIN_USER/ADMIN_PASS` (env) и меняйте пароль по умолчанию
- Обновляйте систему и Node.js
- Включите бэкап базы/файлов
- Рассмотрите PostgreSQL/MySQL для команды >10 человек или высокой нагрузки

---

## FAQ
- Ошибка Prisma с SQLite: убедитесь, что в `.env` используется префикс `file:` — например `DATABASE_URL=file:/var/lib/iosappdistrib/prod.db`
- Сервер не стартует из systemd: проверьте `WorkingDirectory`, `ExecStart` и права на каталог
- Загрузка `.ipa` обрывается: проверьте `client_max_body_size` в сервере 443 Nginx



