require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

console.log('Testing Supabase connection...\n');
console.log('URL:', process.env.SUPABASE_URL);
console.log('Key:', process.env.SUPABASE_ANON_KEY?.substring(0, 20) + '...');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function testConnection() {
  try {
    // Try to list buckets
    const { data, error } = await supabase.storage.listBuckets();
    
    if (error) {
      console.log('\n❌ Ошибка подключения:', error.message);
      console.log('\nВозможные причины:');
      console.log('1. Неправильный SUPABASE_ANON_KEY');
      console.log('2. Нужен ключ из секции "anon public" (начинается с eyJ...)');
      return;
    }
    
    console.log('\n✅ Подключение успешно!');
    console.log('Найденные buckets:', data.map(b => b.name).join(', ') || 'нет');
    
    // Check if screenshots bucket exists
    const screenshotsBucket = data.find(b => b.name === 'screenshots');
    if (!screenshotsBucket) {
      console.log('\n⚠️  Bucket "screenshots" не найден.');
      console.log('Создайте его в Supabase: Storage → New bucket → screenshots');
    } else {
      console.log('\n✅ Bucket "screenshots" найден!');
    }
    
  } catch (err) {
    console.log('\n❌ Ошибка:', err.message);
  }
}

testConnection();
