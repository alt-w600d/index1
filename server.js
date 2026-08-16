const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tyogvnnfodqhkynfsxlq.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5b2d2bm5mb2RxaGt5bmZzeGxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTQxNjUsImV4cCI6MjEwMjQ3MDE2NX0.Si2JwqI7bbC_ZtVbIb_1q-JqpxWqB8UYRATkZn6_CIk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/instructions', upload.any(), async (req, res) => {
  try {
    const { title, category, description } = req.body;
    let media_url = null;

    if (req.files && req.files.length > 0) {
      const file = req.files[0];
      const fileExt = path.extname(file.originalname);
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}${fileExt}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('instruction-media')
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('instruction-media')
        .getPublicUrl(fileName);

      media_url = urlData.publicUrl;
    }

    const { data, error } = await supabase
      .from('instructions')
      .insert([
        {
          title,
          category,
          description,
          media_url,
          status: 'pending'
        }
      ]);

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'Инструкция успешно отправлена' });
  } catch (err) {
    console.error('Ошибка бэкенда:', err);
    return res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера' });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
