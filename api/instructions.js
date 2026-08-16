const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tyogvnnfodqhkynfsxlq.supabase.co';
// ВАЖНО: Используем SERVICE_ROLE_KEY для обхода правил RLS при запись на сервере
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5b2d2bm5mb2RxaGt5bmZzeGxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTQxNjUsImV4cCI6MjEwMjQ3MDE2NX0.Si2JwqI7bbC_ZtVbIb_1q-JqpxWqB8UYRATkZn6_CIk';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не поддерживается' });
  }

  try {
    await runMiddleware(req, res, upload.any());

    const { title, category, description } = req.body;
    let media_url = null;

    if (req.files && req.files.length > 0) {
      const file = req.files[0];
      const fileExt = path.extname(file.originalname);
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}${fileExt}`;

      const { error: uploadError } = await supabase.storage
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

    const { error } = await supabase
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

    return res.status(200).json({ success: true, message: 'Успешно отправлено' });
  } catch (err) {
    console.error('Ошибка Vercel API:', err);
    return res.status(500).json({ error: err.message || 'Ошибка сервера' });
  }
}
