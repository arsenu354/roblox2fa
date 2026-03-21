import React, { useEffect, useState } from 'react';
import { auth, db, handleFirestoreError, OperationType, getWebFcmToken } from './firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { Auth } from './components/Auth';
import { Sidebar } from './components/Sidebar';
import { Emails } from './components/Emails';
import { Settings } from './components/Settings';
import { Info } from './components/Info';
import { Menu, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from './hooks/useTheme';

async function saveFcmToken(userId: string, token: string, platform: 'android' | 'web') {
  try {
    await fetch('/api/save-fcm-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, token, platform }),
    });
    console.log(`[FCM] Token сохранён (${platform})`);
  } catch (e) {
    console.error('[FCM] Ошибка сохранения token:', e);
  }
}

export default function App() {
  const { theme } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('emails');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // FCM токены — запускаем когда юзер залогинен
  useEffect(() => {
    if (!user) return;

    // Android FCM token (приходит из WebView через инжектированный JS)
    const handleAndroidToken = async (event: Event) => {
      const token = (event as CustomEvent).detail?.token;
      if (token) {
        await saveFcmToken(user.uid, token, 'android');
      }
    };
    window.addEventListener('fcmToken', handleAndroidToken);

    // Web FCM token — только для браузера, не для Android WebView
    const initWebFcm = async () => {
      if ((window as any).isAndroidApp) return;
      const webToken = await getWebFcmToken();
      if (webToken) {
        await saveFcmToken(user.uid, webToken, 'web');
      }
    };
    initWebFcm();

    return () => {
      window.removeEventListener('fcmToken', handleAndroidToken);
    };
  }, [user]);

  // Google Auth callback
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS' && auth.currentUser) {
        const { tokens } = event.data;
        try {
          const userRef = doc(db, 'users', auth.currentUser.uid);
          const userSnap = await getDoc(userRef);

          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: auth.currentUser.uid,
              email: auth.currentUser.email || '',
              robloxNickname: 'User_' + auth.currentUser.uid.substring(0, 5),
              createdAt: new Date().toISOString(),
              googleAccessToken: tokens.access_token,
              googleRefreshToken: tokens.refresh_token || null,
              googleTokenExpiry: tokens.expiry_date || null,
              googleConnectedAt: new Date().toISOString(),
            });
          } else {
            await setDoc(userRef, {
              googleAccessToken: tokens.access_token,
              googleRefreshToken: tokens.refresh_token || null,
              googleTokenExpiry: tokens.expiry_date || null,
              googleConnectedAt: new Date().toISOString(),
            }, { merge: true });
          }

          alert('Gmail успешно подключен! Теперь приложение будет искать коды в вашей почте.');
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `users/${auth.currentUser.uid}`);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-500/20"
        >
          <ShieldCheck className="w-10 h-10 text-white" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLogout={handleLogout}
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
      />

      <main className="flex-1 md:ml-64 p-4 md:p-10">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between mb-6 p-4 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-blue-600" />
            <span className="text-xl font-bold dark:text-white">Roblox2FA</span>
          </div>
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all"
          >
            <Menu className="w-6 h-6 dark:text-white" />
          </button>
        </div>

        {/* Content */}
        <div className="max-w-5xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'emails' && <Emails />}
              {activeTab === 'settings' && <Settings />}
              {activeTab === 'info' && <Info />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
