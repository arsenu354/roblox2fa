import express, { Request, Response } from 'express';
import serverless from 'serverless-http';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const FIREBASE_API_KEY = 'AIzaSyDL1yADKOkq3Q0OjVLycc8Xdb3MEdLKTkQ';
const PROJECT_ID = 'project-9e35b839-f404-4a58-ae2';
const DB_ID = 'ai-studio-e2d53176-9f05-45e7-bb6c-d7bf3e802157';
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DB_ID}/documents`;

// ─── Firestore REST helpers ───────────────────────────────────────────────────

async function firestoreGet(collection: string, docId: string) {
  const url = `${FIRESTORE_URL}/${collection}/${docId}?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

// Алиас для совместимости
const getFirestoreDoc = firestoreGet;

async function firestoreSet(collection: string, docId: string, data: Record<string, any>) {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
  }
  const url = `${FIRESTORE_URL}/${collection}/${docId}?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  return res.json();
}

async function addNotification(userId: string, username: string, code: string, notifId?: string) {
  const id = notifId || Date.now().toString();
  const url = `${FIRESTORE_URL}/notifications/${userId}/items/${id}?key=${FIREBASE_API_KEY}`;
  await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        username: { stringValue: username },
        code: { stringValue: String(code) },
        createdAt: { stringValue: new Date().toISOString() },
        shown: { booleanValue: false },
      }
    }),
  });
  console.log(`Уведомление записано: ${userId} → ${username} код ${code}`);
}

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/google/callback`
);

// GET /api/auth/google/url
app.get('/api/auth/google/url', (req: Request, res: Response) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly', 'email', 'profile'],
    prompt: 'consent',
  });
  res.json({ url });
});

// GET /auth/google/callback
app.get('/auth/google/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Ошибка: ${error}`);
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    res.send(`
      <html><head><title>Roblox2FA</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f4f4f5}.card{background:white;padding:2rem;border-radius:1rem;box-shadow:0 4px 6px -1px rgb(0 0 0/0.1);text-align:center}.spinner{border:3px solid #f3f3f3;border-top:3px solid #2563eb;border-radius:50%;width:24px;height:24px;animation:spin 1s linear infinite;margin:1rem auto}@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>
      </head><body><div class="card"><h2>Авторизация успешна!</h2><p>Передаем данные...</p><div class="spinner"></div></div>
      <script>setTimeout(()=>{if(window.opener){window.opener.postMessage({type:'GOOGLE_AUTH_SUCCESS',tokens:${JSON.stringify(tokens)}},'*');setTimeout(()=>window.close(),500)}else{window.location.href='/'}},1000)</script>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send('Ошибка авторизации.');
  }
});

// POST /api/save-fcm-token
app.post('/api/save-fcm-token', async (req: Request, res: Response) => {
  const { userId, token, platform } = req.body;
  if (!userId || !token) return res.status(400).json({ error: 'Missing fields' });
  try {
    await firestoreSet('fcmTokens', userId, { [platform]: token, updatedAt: new Date().toISOString() });
    console.log(`FCM token сохранён: ${userId} (${platform})`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /api/send-notification — записываем уведомление в Firestore
app.post('/api/send-notification', async (req: Request, res: Response) => {
  const { userId, username, code } = req.body;
  if (!userId || !username || !code) return res.status(400).json({ error: 'Missing fields' });
  await addNotification(userId, username, code);
  res.json({ ok: true });
});

// GET /api/gmail/sync-background — WorkManager вызывает это когда приложение закрыто
app.get('/api/gmail/sync-background', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  try {
    // Берём данные юзера из Firestore
    const userDoc = await getFirestoreDoc('users', userId as string);
    if (!userDoc?.fields) return res.json({ ok: true, message: 'No user data' });

    const f = userDoc.fields;
    const accessToken = f?.googleAccessToken?.stringValue;
    const refreshToken = f?.googleRefreshToken?.stringValue;
    const expiryDate = f?.googleTokenExpiry?.integerValue;
    const robloxNickname = f?.robloxNickname?.stringValue;
    const notificationsEnabled = f?.notificationsEnabled?.booleanValue;

    if (!accessToken || !robloxNickname || !notificationsEnabled) {
      return res.json({ ok: true, message: 'Notifications disabled or no gmail' });
    }

    // Настраиваем Gmail клиент
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: expiryDate ? parseInt(expiryDate) : undefined,
    });

    const gmail = google.gmail({ version: 'v1', auth: client });

    // Ищем письма за последние 20 минут
    const after = Math.floor((Date.now() - 20 * 60 * 1000) / 1000);
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `from:accounts@roblox.com ${robloxNickname} after:${after}`,
      maxResults: 3,
    });

    const messages = response.data.messages || [];
    if (messages.length === 0) return res.json({ ok: true, message: 'No new emails' });

    for (const msg of messages) {
      const details = await gmail.users.messages.get({ userId: 'me', id: msg.id! });
      const payload = details.data.payload;
      let body = '';

      const dec = (d: string) => Buffer.from(d.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
      if (payload?.parts) {
        const p = payload.parts.find((p: any) => p.mimeType === 'text/plain') || payload.parts[0];
        if (p?.body?.data) body = dec(p.body.data);
      } else if (payload?.body?.data) {
        body = dec(payload.body.data);
      }

      // Извлекаем 6-значный код
      const codeMatch = body.match(/\b\d{6}\b/);
      if (!codeMatch) continue;
      const code = codeMatch[0];

      // Проверяем не отправляли ли уже это уведомление
      const notifId = `gmail_${msg.id}`;
      const existing = await getFirestoreDoc(`notifications/${userId}/items`, notifId);
      if (existing && !existing.error) continue; // уже отправляли

      // Записываем в Firestore
      await addNotification(userId as string, robloxNickname, code, notifId);
      console.log(`Background sync: уведомление записано для ${userId}, код ${code}`);
    }

    res.json({ ok: true, synced: messages.length });
  } catch (err) {
    console.error('gmail/sync-background error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// GET /api/check-notifications — Android WorkManager читает отсюда
app.get('/api/check-notifications', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  try {
    const url = `${FIRESTORE_URL}/notifications/${userId}/items?key=${FIREBASE_API_KEY}&orderBy=createdAt+desc&pageSize=5`;
    const result = await fetch(url);
    const data = await result.json();
    const docs = data.documents || [];
    const notifications = docs
      .map((doc: any) => {
        const f = doc.fields;
        return {
          id: doc.name?.split('/').pop(),
          username: f?.username?.stringValue,
          code: f?.code?.stringValue,
          createdAt: f?.createdAt?.stringValue,
          shown: f?.shown?.booleanValue,
        };
      })
      .filter((n: any) => !n.shown);
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /api/mark-notification-shown
app.post('/api/mark-notification-shown', async (req: Request, res: Response) => {
  const { userId, notifId } = req.body;
  if (!userId || !notifId) return res.status(400).json({ error: 'Missing fields' });
  const url = `${FIRESTORE_URL}/notifications/${userId}/items/${notifId}?key=${FIREBASE_API_KEY}`;
  await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { shown: { booleanValue: true } } }),
  });
  res.json({ ok: true });
});

// POST /api/gmail/fetch
app.post('/api/gmail/fetch', async (req: Request, res: Response) => {
  const { accessToken, refreshToken, expiryDate, robloxNickname } = req.body;
  if (!accessToken || !robloxNickname) return res.status(400).json({ error: 'Missing fields' });

  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken, expiry_date: expiryDate });
  const gmail = google.gmail({ version: 'v1', auth: client });

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `from:accounts@roblox.com ${robloxNickname}`,
      maxResults: 10,
    });
    const messages = response.data.messages || [];
    const emailData = await Promise.all(messages.map(async (msg) => {
      try {
        const details = await gmail.users.messages.get({ userId: 'me', id: msg.id! });
        const payload = details.data.payload;
        const headers = payload?.headers;
        const subject = headers?.find((h: any) => h.name === 'Subject')?.value || 'Без темы';
        const from = headers?.find((h: any) => h.name === 'From')?.value || 'Неизвестно';
        const date = headers?.find((h: any) => h.name === 'Date')?.value || new Date().toISOString();
        const dec = (d: string) => Buffer.from(d.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
        let body = '';
        if (payload?.parts) {
          const p = payload.parts.find((p: any) => p.mimeType === 'text/plain') || payload.parts[0];
          if (p?.body?.data) body = dec(p.body.data);
        } else if (payload?.body?.data) body = dec(payload.body.data);
        return {
          id: msg.id,
          from,
          subject,
          body: body.replace(/<[^>]*>?/gm, '').trim().substring(0, 1000),
          receivedAt: new Date(date).toISOString(),
          isRead: !details.data.labelIds?.includes('UNREAD'),
        };
      } catch { return null; }
    }));
    res.json({ emails: emailData.filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

export const handler = serverless(app);
