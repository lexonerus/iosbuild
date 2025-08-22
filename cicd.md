## CI/CD план: быстрый деплой сайта и бэкенда

### Обзор
- Репозиторий GitHub → GitHub Actions.
- Деплой по SSH/rsync:
  - website → `/var/www/iosbuild.ru/html` (Apache/Nginx отдаёт статику).
  - backend → `/opt/iosappdistrib` (systemd + reverse proxy).

Почему rsync: работает на любом сервере с SSH, быстро и без агентских инсталляций.

---

### Подготовка сервера (однократно)
1) Создать пользователя деплоя (можно использовать уже созданного `iosapp`):
```bash
sudo adduser deployer
sudo usermod -aG www-data deployer
```
2) Дать доступ на каталоги:
```bash
sudo chown -R deployer:www-data /var/www/iosbuild.ru/html
sudo chmod -R g+rwX /var/www/iosbuild.ru/html
sudo find /var/www/iosbuild.ru/html -type d -exec chmod g+s {} \;

sudo mkdir -p /opt/iosappdistrib
sudo chown -R deployer:deployer /opt/iosappdistrib
```
3) SSH‑ключ для GitHub Actions:
```bash
ssh-keygen -t ed25519 -C "github-actions@iosbuild.ru"
# приватный ключ сохраните локально, публичный:
cat ~/.ssh/id_ed25519.pub | sudo tee -a /home/deployer/.ssh/authorized_keys
sudo chown -R deployer:deployer /home/deployer/.ssh && sudo chmod 700 /home/deployer/.ssh && sudo chmod 600 /home/deployer/.ssh/authorized_keys
```
4) Разрешить деплойеру рестарт сервиса (без пароля):
```bash
echo "deployer ALL=NOPASSWD:/bin/systemctl restart iosappdistrib" | sudo tee /etc/sudoers.d/iosappdistrib
```
5) .env на сервере для бэкенда (секреты только на сервере):
```bash
sudo -u deployer bash -lc 'cd /opt/iosappdistrib || mkdir -p /opt/iosappdistrib && cd /opt/iosappdistrib; \
  echo "DATABASE_URL=file:/var/lib/iosappdistrib/prod.db" > .env; \
  echo "ADMIN_USER=admin" >> .env; \
  echo "ADMIN_PASS=change-me" >> .env'
```

---

### Секреты в GitHub (Settings → Secrets and variables → Actions)
- `SSH_HOST` — ваш домен или IP
- `SSH_PORT` — порт SSH (обычно 22)
- `SSH_USER` — `deployer`
- `SSH_PRIVATE_KEY` — приватный ключ (ed25519)
- `WEB_ROOT` — `/var/www/iosbuild.ru/html`
- `APP_DIR` — `/opt/iosappdistrib`

Дополнительно для бэкенда: на сервере `.env` с `DATABASE_URL`, `ADMIN_USER/PASS` уже должен быть создан.

---

### GitHub Actions: website → `/var/www/iosbuild.ru/html`
Триггер: push в `website/**` и ручной запуск. Перемещает только содержимое директории `website/`.

Файл: `.github/workflows/deploy-website.yml` (уже добавлен в репозиторий).

---

### GitHub Actions: backend → `/opt/iosappdistrib`
Триггер: push в `src/**`, `prisma/**`, `package*.json`, `tsconfig.json` и ручной запуск.

Процесс:
1) Сборка в CI (`npm ci`, `npm run build`)
2) rsync исходников (исключая `.git`, `node_modules`, `.env`, `src/uploads`) на сервер
3) На сервере: `npm ci --omit=dev`, `npx prisma migrate deploy`, `npm run build`, `sudo systemctl restart iosappdistrib`

Файл: `.github/workflows/deploy-backend.yml` (уже добавлен в репозиторий).

---

### Пошаговый чек-лист запуска CI/CD
1) Создать пользователя `deployer` на сервере и выдать права на каталоги сайта/приложения
2) Сгенерировать отдельный SSH‑ключ для CI и добавить .pub в `/home/deployer/.ssh/authorized_keys`
3) В GitHub добавить Secrets: `SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_PRIVATE_KEY`, `WEB_ROOT`, `APP_DIR`
4) Убедиться, что `.env` создан на сервере и не хранится в репозитории
5) Сделать тестовый commit в `website/` → проверить job `Deploy Website`
6) Сделать тестовый commit бэкенда → проверить job `Deploy Backend`

---

### Безопасность: публичный репозиторий
- Секреты и приватные данные:
  - `.env`, БД (`*.db`, `dev.db`), `src/uploads/` — уже в `.gitignore`, не коммитить
  - Любые ключи/пароли — только в GitHub Secrets или на сервере в `.env`
- Изоляция и права:
  - Отдельный пользователь `deployer` для деплоя, отдельный пользователь сервиса в systemd
  - В sudoers дать деплойеру право только на `systemctl restart iosappdistrib`
- SSH‑доступ:
  - Отключить парольный вход, оставить только ключи (`PasswordAuthentication no` в sshd_config)
  - Ограничить rDNS/страны по firewall при необходимости
- CI доверие:
  - В GitHub Settings → Actions ограничить запускаемые Actions и разрешать только trusted actions
  - Проверять Pull Requests перед merge
- Сервер:
  - Обновления ОС/Node.js
  - Бэкап `/var/lib/iosappdistrib/prod.db` и каталогов с загрузками

---

### Проверка
1) Push изменения в `website/` → Actions → `Deploy Website` должен отработать, сайт обновится
2) Push изменения бэкенда → Actions → `Deploy Backend` перезапустит сервис

Если нужны staging/production — добавьте два workflow с разными секретами и ветками.


