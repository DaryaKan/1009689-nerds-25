# 📸 Image Library

Облачная библиотека изображений с поддержкой загрузки через веб-интерфейс и Telegram-бота.

## 🚀 Возможности

- ☁️ Хранение изображений в Supabase Storage
- 🌐 Веб-интерфейс с drag & drop загрузкой
- 🤖 Telegram-бот для загрузки фото
- 📋 API для интеграции с другими приложениями
- 🖼️ Галерея с превью и лайтбоксом
- 🔗 Публичные ссылки на изображения

## 📋 Требования

- Node.js 18+
- Аккаунт Supabase (бесплатный)
- Telegram Bot Token (от @BotFather)

## 🔧 Установка

### 1. Установите зависимости

```bash
cd server
npm install
```

### 2. Настройте Supabase

1. Зарегистрируйтесь на [supabase.com](https://supabase.com)
2. Создайте новый проект
3. Перейдите в **Settings → API** и скопируйте:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`

### 3. Создайте Storage Bucket

1. В Supabase перейдите в **Storage**
2. Нажмите **New bucket**
3. Введите имя: `screenshots`
4. ✅ Включите **Public bucket** (для публичного доступа)
5. Нажмите **Create bucket**

### 4. Настройте RLS политики (опционально для публичного доступа)

Перейдите в **Storage → Policies** и добавьте политики для bucket `screenshots`:

```sql
-- Разрешить всем читать
CREATE POLICY "Public Read" ON storage.objects FOR SELECT USING (bucket_id = 'screenshots');

-- Разрешить всем загружать
CREATE POLICY "Public Upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'screenshots');

-- Разрешить всем удалять
CREATE POLICY "Public Delete" ON storage.objects FOR DELETE USING (bucket_id = 'screenshots');
```

Или в интерфейсе выберите:
- **SELECT** → Allow public access
- **INSERT** → Allow public access  
- **DELETE** → Allow public access

### 5. Создайте Telegram бота

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram
2. Отправьте `/newbot`
3. Введите имя бота и username
4. Скопируйте токен → `TELEGRAM_BOT_TOKEN`

### 6. Создайте .env файл

```bash
cp .env.example .env
```

Отредактируйте `.env`:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_BUCKET=screenshots
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
PORT=3000
```

## ▶️ Запуск

### Запуск веб-сервера

```bash
npm start
```

Сервер будет доступен по адресу: http://localhost:3000

### Запуск Telegram бота

```bash
npm run bot
```

### Запуск обоих сервисов

В двух терминалах:
```bash
# Терминал 1
npm start

# Терминал 2
npm run bot
```

## 📡 API Endpoints

| Метод | Endpoint | Описание |
|-------|----------|----------|
| `POST` | `/api/upload` | Загрузить одно изображение |
| `POST` | `/api/upload-multiple` | Загрузить несколько изображений |
| `GET` | `/api/images` | Получить список всех изображений |
| `GET` | `/api/images/:id` | Получить информацию об изображении |
| `DELETE` | `/api/images/:id` | Удалить изображение |
| `GET` | `/api/health` | Проверка состояния сервера |

### Примеры использования API

#### Загрузка изображения (curl)

```bash
curl -X POST http://localhost:3000/api/upload \
  -F "image=@/path/to/image.jpg"
```

#### Загрузка нескольких изображений

```bash
curl -X POST http://localhost:3000/api/upload-multiple \
  -F "images=@image1.jpg" \
  -F "images=@image2.png"
```

#### Получить список изображений

```bash
curl http://localhost:3000/api/images
```

#### JavaScript fetch

```javascript
// Загрузка файла
const formData = new FormData();
formData.append('image', fileInput.files[0]);

const response = await fetch('/api/upload', {
  method: 'POST',
  body: formData
});

const data = await response.json();
console.log(data.image.url); // Публичная ссылка
```

## 🤖 Команды Telegram бота

| Команда | Описание |
|---------|----------|
| `/start` | Приветственное сообщение |
| `/help` | Справка по использованию |
| `/list` | Последние 10 изображений |
| `/stats` | Статистика хранилища |

**Для загрузки:** просто отправьте фото боту!

## 🌐 Веб-интерфейс

Откройте http://localhost:3000/library для доступа к галерее.

Возможности:
- Drag & drop загрузка
- Просмотр галереи
- Лайтбокс для полноразмерных изображений
- Копирование URL в буфер
- Удаление изображений

## 📁 Структура проекта

```
server/
├── index.js        # Express сервер с API
├── bot.js          # Telegram бот
├── package.json    # Зависимости
├── .env.example    # Пример конфигурации
└── README.md       # Документация

library.html        # Веб-интерфейс галереи
```

## 🔒 Безопасность

- Для production добавьте авторизацию
- Ограничьте размер файлов
- Используйте HTTPS
- Настройте CORS для своего домена

## 🐛 Устранение неполадок

**Ошибка "Bucket not found":**
- Проверьте имя bucket в .env
- Убедитесь что bucket создан в Supabase

**Ошибка "Policy violation":**
- Настройте RLS политики для bucket
- Или включите Public bucket

**Бот не отвечает:**
- Проверьте токен бота
- Убедитесь что бот запущен

## 📄 Лицензия

MIT
