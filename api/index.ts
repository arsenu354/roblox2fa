import express, { Request, Response } from 'express';
import serverless from 'serverless-http';
import { google } from 'googleapis';
import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

// 🔥 Firebase init (ОДИН РАЗ, безопасно)
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccount) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT is missing");
}

if (!admin.apps?.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(serviceAccount)),
  });
  console.log("✅ Firebase initialized");
}

const db = admin.firestore();

// ===== UTILS =====

async function getDoc(collection: string, docId: string) {
  try {
    const doc = await db.collection(collection).doc(docId).get();
    return doc.exists ? doc.data() : null;
  } catch (err) {
    console.error(`getDoc error:`, err);
    return null;
  }
}

async function setDoc(collection: string, docId: string, data: any, merge = true) {
  try {
    await db.collection(collection).doc(docId).set(data, { merge });
    return true;
  } catch (err) {
    console.error(`setDoc error:`, err);
    return false;
  }
}

// ===== EXPRESS =====

const app = express();
app.use(express.json());

// ===== GOOGLE AUTH =====

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/google/callback`
);

app.get('/api/auth/google/url', (req: Request, res: Response) => {
  const { userId } = req.query;

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'email',
      'profile'
    ],
    prompt: 'consent',
    state: (userId as string) || '',
  });

  res.json({ url });
});

app.get('/auth/google/callback', async (req: Request, res: Response) => {
  const { code, error, state } = req.query;

  if (error) return res.status(400).send(`Ошибка: ${error}`);

  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    const userId = state as string;

    if (userId) {
      await setDoc('users', userId, {
        googleAccessToken: tokens.access_token || '',
        googleRefreshToken: tokens.refresh_token || '',
        googleTokenExpiry: tokens.expiry_date?.toString() || '',
      });
    }

    res.send("✅ Gmail подключён");
  } catch (err) {
    console.error(err);
    res.status(500).send("Ошибка");
  }
});

// ===== FCM =====

app.post('/api/save-fcm-token', async (req: Request, res: Response) => {
  const { userId, token } = req.body;

  if (!userId || !token) {
    return res.status(400).json({ error: "Missing fields" });
  }

  await setDoc('fcmTokens', userId, {
    android: token,
    updatedAt: new Date().toISOString(),
  });

  res.json({ ok: true });
});

// ===== TEST ROUTE =====

app.get('/api/check-notifications', async (req: Request, res: Response) => {
  res.json({ ok: true });
});

// ===== EXPORT ДЛЯ VERCEL =====

export default serverless(app);