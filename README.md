## iOSAppDistrib — внутреннее распространение .ipa

### Быстрый старт (локально)
1) Требования: Node 20+, npm
2) Установка:
```bash
npm install
```
3) Инициализация БД (SQLite):
```bash
echo DATABASE_URL=file:./dev.db > .env
npm run prisma:migrate
```
4) Запуск dev-сервера:
```bash
npm run dev
```
Откройте http://localhost:3000/public/ — страница загрузки .ipa.

API:
- POST /upload — загрузка .ipa (multipart form-data, поле `file`). Возвращает `slug` и ссылки.
- GET /ipa/:slug — скачать исходный .ipa
- GET /l/:slug — landing JSON (позже станет OTA-страницей)
- GET /health — проверка

Логины для базовой авторизации админских маршрутов (заготовка): переменные окружения `ADMIN_USER`/`ADMIN_PASS` (по умолчанию admin/admin).

### Production

- Настройте переменную `DATABASE_URL` (для SQLite `file:./prod.db`, для Postgres — строка подключения и замените провайдера в prisma/schema.prisma).
- Соберите и запустите:
```bash
npm run build
npm start
```
- Реверс-прокси (Nginx) с HTTPS. Пример:
```nginx
server {
  listen 443 ssl http2;
  server_name your.domain.com;

  ssl_certificate     /etc/letsencrypt/live/your.domain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/your.domain.com/privkey.pem;

  client_max_body_size 300m; # для .ipa

  location / {
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:3000;
  }

  # Корректные MIME для OTA (добавим при реализации OTA)
  types {
    application/octet-stream ipa;
    application/xml plist;
  }
}
```

### OTA (план)
- Эндпоинт manifest.plist: `GET /manifest/:slug` с правильным plist-контентом
- Страница установки через Safari `GET /l/:slug` с ссылкой `itms-services://?action=download-manifest&url=https://.../manifest/:slug`
- Проверка истечения срока, лимитов установок

### Важное
- Загружаемые файлы в `src/uploads/`
- Rate limit включён
- Для безопасного продакшена: HTTPS, ограничение доступа, проверка подписей IPA, аудит
