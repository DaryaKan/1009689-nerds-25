require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const BUCKET = process.env.SUPABASE_BUCKET || 'screenshots';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN is not set in .env file');
  process.exit(1);
}

// Create bot instance
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('Telegram bot started...');

// Helper function to download file from Telegram
async function downloadFile(fileUrl) {
  return new Promise((resolve, reject) => {
    const protocol = fileUrl.startsWith('https') ? https : http;
    
    protocol.get(fileUrl, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

// Helper function to get file extension from mime type
function getExtension(mimetype) {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp'
  };
  return extensions[mimetype] || 'jpg';
}

// Start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
🖼 *Добро пожаловать в Image Library Bot!*

Я помогу вам загружать изображения в облачную библиотеку.

*Доступные команды:*
/start - Показать это сообщение
/help - Справка по использованию
/list - Показать последние загруженные изображения
/stats - Статистика хранилища

*Как загрузить изображение:*
Просто отправьте мне фото или документ-изображение, и я загружу его в библиотеку.

Вы также можете отправить несколько изображений одновременно!
  `;
  
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = `
📚 *Справка по Image Library Bot*

*Загрузка изображений:*
• Отправьте фото как изображение (сжатое)
• Отправьте фото как документ (оригинальное качество)
• Можно отправлять несколько фото за раз

*Поддерживаемые форматы:*
JPEG, PNG, GIF, WebP

*Ограничения:*
• Максимальный размер файла: 20 MB
• Максимум 10 файлов за раз

*Команды:*
/list - Последние 10 изображений
/stats - Информация о хранилище
  `;
  
  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// List recent images
bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list('images', {
        limit: 10,
        offset: 0,
        sortBy: { column: 'created_at', order: 'desc' }
      });

    if (error) {
      bot.sendMessage(chatId, '❌ Ошибка при получении списка изображений');
      return;
    }

    const images = data.filter(file => file.name !== '.emptyFolderPlaceholder');

    if (images.length === 0) {
      bot.sendMessage(chatId, '📭 Библиотека пуста. Отправьте мне изображение!');
      return;
    }

    let message = `📸 *Последние ${images.length} изображений:*\n\n`;
    
    images.forEach((file, index) => {
      const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(`images/${file.name}`);
      
      message += `${index + 1}. [${file.name}](${urlData.publicUrl})\n`;
    });

    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });

  } catch (error) {
    console.error('List error:', error);
    bot.sendMessage(chatId, '❌ Произошла ошибка');
  }
});

// Stats command
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list('images', { limit: 1000 });

    if (error) {
      bot.sendMessage(chatId, '❌ Ошибка при получении статистики');
      return;
    }

    const images = data.filter(file => file.name !== '.emptyFolderPlaceholder');
    const totalSize = images.reduce((acc, file) => acc + (file.metadata?.size || 0), 0);
    const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);

    const statsMessage = `
📊 *Статистика библиотеки*

📁 Всего изображений: *${images.length}*
💾 Общий размер: *${sizeMB} MB*
☁️ Хранилище: *Supabase*
    `;

    bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Stats error:', error);
    bot.sendMessage(chatId, '❌ Произошла ошибка');
  }
});

// Handle photo uploads
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Get the highest resolution photo
    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;
    
    const statusMsg = await bot.sendMessage(chatId, '⏳ Загружаю изображение...');
    
    // Get file info from Telegram
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    
    // Download file
    const fileBuffer = await downloadFile(fileUrl);
    
    // Determine extension
    const ext = file.file_path.split('.').pop() || 'jpg';
    const fileName = `${uuidv4()}.${ext}`;
    const filePath = `images/${fileName}`;
    
    // Upload to Supabase
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, fileBuffer, {
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        upsert: false
      });

    if (error) {
      console.error('Upload error:', error);
      await bot.editMessageText('❌ Ошибка при загрузке в хранилище', {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });
      return;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(filePath);

    await bot.editMessageText(
      `✅ *Изображение загружено!*\n\n🔗 [Открыть](${urlData.publicUrl})`,
      {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown'
      }
    );

  } catch (error) {
    console.error('Photo upload error:', error);
    bot.sendMessage(chatId, '❌ Произошла ошибка при загрузке');
  }
});

// Handle document uploads (for original quality images)
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const doc = msg.document;
  
  // Check if it's an image
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(doc.mime_type)) {
    bot.sendMessage(chatId, '⚠️ Пожалуйста, отправьте изображение (JPEG, PNG, GIF или WebP)');
    return;
  }
  
  try {
    const statusMsg = await bot.sendMessage(chatId, '⏳ Загружаю изображение...');
    
    // Get file info from Telegram
    const file = await bot.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    
    // Download file
    const fileBuffer = await downloadFile(fileUrl);
    
    // Generate filename
    const ext = getExtension(doc.mime_type);
    const fileName = `${uuidv4()}.${ext}`;
    const filePath = `images/${fileName}`;
    
    // Upload to Supabase
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, fileBuffer, {
        contentType: doc.mime_type,
        upsert: false
      });

    if (error) {
      console.error('Upload error:', error);
      await bot.editMessageText('❌ Ошибка при загрузке в хранилище', {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });
      return;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(filePath);

    const sizeKB = (doc.file_size / 1024).toFixed(1);

    await bot.editMessageText(
      `✅ *Изображение загружено!*\n\n📄 Оригинальное имя: ${doc.file_name}\n💾 Размер: ${sizeKB} KB\n🔗 [Открыть](${urlData.publicUrl})`,
      {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown'
      }
    );

  } catch (error) {
    console.error('Document upload error:', error);
    bot.sendMessage(chatId, '❌ Произошла ошибка при загрузке');
  }
});

// Handle errors
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.code, error.message);
});

console.log(`
╔════════════════════════════════════════════════════════╗
║           Telegram Bot Started                         ║
╠════════════════════════════════════════════════════════╣
║  Send photos to the bot to upload them to the library  ║
║                                                        ║
║  Commands:                                             ║
║  /start - Welcome message                              ║
║  /help  - Help information                             ║
║  /list  - List recent images                           ║
║  /stats - Storage statistics                           ║
╚════════════════════════════════════════════════════════╝
`);
