import express, { Request, Response } from 'express';
import serverless from 'serverless-http';
import { google } from 'googleapis';
import * as admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

// ─── Firebase Admin ───────────────────────────────────────────────────────────
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('Firebase Admin инициализирован:', serviceAccount.project_id);
  } catch (err) {
    console.error('Firebase Admin init error:', err);
  }
}

// ─── Firestore REST helpers ───────────────────────────────────────────────────
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyDL1yADKOkq3Q0OjVLycc8Xdb3MEdLKTkQ';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'roblox2fa-4283e';
const DB_ID = process.env.FIREBASE_DB_ID || '(default)';
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DB_ID}/documents`;

async function firestoreGet(collection: string, docId: string) {
  const url = `${FIRESTORE_URL}/${collection}/${docId}?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

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

// ─── FCM Push через Firebase Admin (HTTP v1) ──────────────────────────────────
async function sendFcmPush(userId: string, username: string, code: string) {
  if (!admin.apps.length) {
    console.warn('Firebase Admin не инициализирован');
    return;
  }
  try {
    const tokenDoc = await firestoreGet('fcmTokens', userId);
    if (!tokenDoc?.fields) {
      console.log('FCM токен не найден для:', userId);
      return;
    }
    const androidToken = tokenDoc.fields?.android?.stringValue;
    if (!androidToken) {
      console.log('Android FCM token пустой');
      return;
    }
    console.log('Отправляем FCM push, токен:', androidToken.substring(0, 20) + '...');
    const message = {
      token: androidToken,
      data: {
        title: `Запрос на вход: ${username}`,
        body: `Код подтверждения: ${code}`,
        code: String(code),
        username: String(username),
        type: 'roblox_code',
      },
      android: {
        priority: 'high' as const,
        notification: {
          channelId: 'roblox2fa',
          priority: 'max' as const,
          sound: 'default',
          title: `🎮 Запрос на вход: ${username}`,
          body: `Код: ${code}`,
        },
      },
    };
    const result = await admin.messaging().send(message);
    console.log('✅ FCM push отправлен:', result);
  } catch (err: any) {
    console.error('FCM push error:', err?.message || err);
  }
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
  await sendFcmPush(userId, username, code);
  console.log(`Уведомление: ${userId} → ${username} код ${code}`);
}

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'com.dedition.robloxtwofa://oauth'  // Deep link redirect
);

app.get('/api/auth/google/url', (req: Request, res: Response) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly', 'email', 'profile'],
    prompt: 'consent',
  });
  res.json({ url });
});

app.get('/auth/google/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Ошибка: ${error}`);
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    res.send(`
      <html><head><title>Roblox2FA</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f4f4f5}.card{background:white;padding:2rem;border-radius:1rem;box-shadow:0 4px 6px -1px rgb(0 0 0/0.1);text-align:center}</style>
      </head><body><div class="card"><h2>Авторизация успешна!</h2></div>
      <script>setTimeout(()=>{if(window.opener){window.opener.postMessage({type:'GOOGLE_AUTH_SUCCESS',tokens:${JSON.stringify(tokens)}},'*');setTimeout(()=>window.close(),500)}else{window.location.href='/'}},1000)</script>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send('Ошибка авторизации.');
  }
});

app.post('/api/save-fcm-token', async (req: Request, res: Response) => {
  const { userId, token, platform } = req.body;
  if (!userId || !token) return res.status(400).json({ error: 'Missing fields' });
  try {
    await firestoreSet('fcmTokens', userId, {
      [platform || 'android']: token,
      updatedAt: new Date().toISOString()
    });
    console.log(`FCM token сохранён: ${userId} (${platform})`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /api/auth/google/exchange — обмен code на токены
app.post('/api/auth/google/exchange', async (req: Request, res: Response) => {
  const { code, userId } = req.body;
  if (!code || !userId) return res.status(400).json({ error: 'Missing fields' });

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('Got tokens for user:', userId);

    // Сохраняем токены в Firestore
    await firestoreSet('users', userId, {
      googleAccessToken: tokens.access_token || '',
      googleRefreshToken: tokens.refresh_token || '',
      googleTokenExpiry: tokens.expiry_date ? String(tokens.expiry_date) : '',
    });

    res.json({ ok: true });
  } catch (err: any) {
    console.error('OAuth exchange error:', err?.message);
    res.status(500).json({ error: err?.message || 'Failed' });
  }
});

app.post('/api/send-notification', async (req: Request, res: Response) => {
  const { userId, username, code } = req.body;
  if (!userId || !username || !code) return res.status(400).json({ error: 'Missing fields' });
  await addNotification(userId, username, code);
  res.json({ ok: true });
});

app.post('/api/send-verification-code', async (req: Request, res: Response) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Missing fields' });
  console.log(`=== VERIFICATION CODE for ${email}: ${code} ===`);
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: process.env.RESEND_FROM || 'onboarding@resend.dev',
        to: email,
        subject: 'Ваш код подтверждения — Roblox2FA',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f4f4f5;border-radius:16px;">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="font-size:48px;">🛡</div>
              <h1 style="color:#18181b;margin:8px 0;">Roblox2FA</h1>
            </div>
            <div style="background:white;border-radius:12px;padding:24px;text-align:center;">
              <p style="color:#71717a;margin-bottom:16px;">Ваш код подтверждения:</p>
              <div style="font-size:42px;font-weight:bold;letter-spacing:12px;color:#2563eb;padding:16px;background:#f0f4ff;border-radius:8px;margin-bottom:16px;">
                ${code}
              </div>
              <p style="color:#71717a;font-size:13px;">Код действителен <strong>10 минут</strong>.</p>
            </div>
          </div>
        `
      });
    } catch (err: any) {
      console.error('Resend error:', err?.message);
    }
  }
  res.json({ ok: true });
});

app.get('/api/gmail/sync-background', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  try {
    const userDoc = await getFirestoreDoc('users', userId as string);
    if (!userDoc?.fields) return res.json({ ok: true, message: 'No user data' });
    const f = userDoc.fields;
    const accessToken = f?.googleAccessToken?.stringValue;
    const refreshToken = f?.googleRefreshToken?.stringValue;
    const expiryDate = f?.googleTokenExpiry?.integerValue;
    const robloxNickname = f?.robloxNickname?.stringValue;
    const notificationsEnabled = f?.notificationsEnabled?.booleanValue;
    if (!accessToken || !robloxNickname || !notificationsEnabled) {
      return res.json({ ok: true, message: 'no gmail or notifications disabled' });
    }
    const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    client.setCredentials({ access_token: accessToken, refresh_token: refreshToken, expiry_date: expiryDate ? parseInt(expiryDate) : undefined });
    const gmail = google.gmail({ version: 'v1', auth: client });
    const after = Math.floor((Date.now() - 20 * 60 * 1000) / 1000);
    const response = await gmail.users.messages.list({ userId: 'me', q: `from:accounts@roblox.com ${robloxNickname} after:${after}`, maxResults: 3 });
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
      } else if (payload?.body?.data) body = dec(payload.body.data);
      const codeMatch = body.match(/\b\d{6}\b/);
      if (!codeMatch) continue;
      const code = codeMatch[0];
      const notifId = `gmail_${msg.id}`;
      const existing = await getFirestoreDoc(`notifications/${userId}/items`, notifId);
      if (existing && !existing.error) continue;
      await addNotification(userId as string, robloxNickname, code, notifId);
    }
    res.json({ ok: true, synced: messages.length });
  } catch (err) {
    console.error('sync-background error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/check-notifications', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  try {
    const url = `${FIRESTORE_URL}/notifications/${userId}/items?key=${FIREBASE_API_KEY}&pageSize=5`;
    const result = await fetch(url);
    const data = await result.json();
    const docs = data.documents || [];
    const notifications = docs.map((doc: any) => {
      const f = doc.fields;
      return { id: doc.name?.split('/').pop(), username: f?.username?.stringValue, code: f?.code?.stringValue, createdAt: f?.createdAt?.stringValue, shown: f?.shown?.booleanValue };
    }).filter((n: any) => !n.shown);
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.post('/api/mark-notification-shown', async (req: Request, res: Response) => {
  const { userId, notifId } = req.body;
  if (!userId || !notifId) return res.status(400).json({ error: 'Missing fields' });
  const url = `${FIRESTORE_URL}/notifications/${userId}/items/${notifId}?key=${FIREBASE_API_KEY}`;
  await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { shown: { booleanValue: true } } }) });
  res.json({ ok: true });
});

app.post('/api/gmail/fetch', async (req: Request, res: Response) => {
  const { accessToken, refreshToken, expiryDate, robloxNickname } = req.body;
  if (!accessToken || !robloxNickname) return res.status(400).json({ error: 'Missing fields' });
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken, expiry_date: expiryDate });
  const gmail = google.gmail({ version: 'v1', auth: client });
  try {
    const response = await gmail.users.messages.list({ userId: 'me', q: `from:accounts@roblox.com ${robloxNickname}`, maxResults: 10 });
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
        return { id: msg.id, from, subject, body: body.replace(/<[^>]*>?/gm, '').trim().substring(0, 1000), receivedAt: new Date(date).toISOString(), isRead: !details.data.labelIds?.includes('UNREAD') };
      } catch { return null; }
    }));
    res.json({ emails: emailData.filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

export const handler = serverless(app);