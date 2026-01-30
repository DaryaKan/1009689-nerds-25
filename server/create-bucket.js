require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function createBucket() {
  console.log('Создаю bucket "screenshots"...\n');
  
  const { data, error } = await supabase.storage.createBucket('screenshots', {
    public: true,  // Публичный доступ к файлам
    fileSizeLimit: 10485760  // 10MB лимит
  });
  
  if (error) {
    if (error.message.includes('already exists')) {
      console.log('✅ Bucket "screenshots" уже существует!');
    } else {
      console.log('❌ Ошибка:', error.message);
      console.log('\nСоздайте bucket вручную:');
      console.log('1. Откройте Supabase → Storage');
      console.log('2. Нажмите "New bucket"');
      console.log('3. Имя: screenshots');
      console.log('4. Включите "Public bucket"');
      console.log('5. Нажмите "Create bucket"');
    }
    return;
  }
  
  console.log('✅ Bucket "screenshots" создан!');
}

createBucket();
