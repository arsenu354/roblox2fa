import React, { useState } from 'react';
import { useTheme, Theme } from '../hooks/useTheme';
import { Sun, Moon, Monitor, Palette, Bell, Shield, Trash2, Mail, CheckCircle, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { doc, updateDoc, deleteDoc, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { deleteUser } from 'firebase/auth';

export function Settings() {
  const { theme, setTheme } = useTheme();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [userProfile, setUserProfile] = React.useState<any>(null);
  const [robloxNickname, setRobloxNickname] = useState('');
  const [isSavingNickname, setIsSavingNickname] = useState(false);
  const [isUpdatingNotifications, setIsUpdatingNotifications] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [passwordResetSent, setPasswordResetSent] = useState(false);
  const [passwordResetError, setPasswordResetError] = useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const updatePermission = () => {
      const current = Notification.permission;
      if (current !== permissionStatus) setPermissionStatus(current);
    };
    updatePermission();
    window.addEventListener('focus', updatePermission);
    const interval = setInterval(updatePermission, 1000);
    return () => {
      window.removeEventListener('focus', updatePermission);
      clearInterval(interval);
    };
  }, [permissionStatus]);

  React.useEffect(() => {
    if (!auth.currentUser) return;
    const unsubscribe = onSnapshot(doc(db, 'users', auth.currentUser.uid), (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setUserProfile(data);
        setRobloxNickname(data.robloxNickname || '');
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `users/${auth.currentUser?.uid}`);
    });
    return () => unsubscribe();
  }, []);

  const handleSaveNickname = async () => {
    if (!auth.currentUser || !robloxNickname.trim()) return;
    setIsSavingNickname(true);
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        robloxNickname: robloxNickname.trim()
      });
      alert('Никнейм Roblox успешно обновлен!');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${auth.currentUser.uid}`);
    } finally {
      setIsSavingNickname(false);
    }
  };

  const themeOptions: { id: Theme; label: string; icon: any }[] = [
    { id: 'light', label: 'Светлая', icon: Sun },
    { id: 'dark', label: 'Темная', icon: Moon },
    { id: 'system', label: 'Системная', icon: Monitor },
  ];

  const handleDeleteAccount = async () => {
    if (!auth.currentUser) return;
    const user = auth.currentUser;
    const userId = user.uid;
    setIsDeleting(true);
    try {
      const emailsQuery = query(collection(db, 'emails'), where('userId', '==', userId));
      const emailsSnapshot = await getDocs(emailsQuery);
      const deletePromises = emailsSnapshot.docs.map(emailDoc => deleteDoc(emailDoc.ref));
      await Promise.all(deletePromises);
      await deleteDoc(doc(db, 'users', userId));
      await deleteUser(user);
      window.location.reload();
    } catch (err: any) {
      if (err.code === 'auth/requires-recent-login') {
        alert('Для удаления аккаунта требуется недавний вход. Выйдите и войдите снова.');
      } else {
        alert('Ошибка при удалении: ' + (err.message || 'Неизвестная ошибка'));
      }
    } finally {
      setIsDeleting(false);
      setShowConfirm(false);
    }
  };

  const handleConnectGmail = async () => {
    setIsConnecting(true);
    try {
      const response = await fetch('/api/auth/google/url');
      const { url } = await response.json();
      window.open(url, 'google_auth', 'width=600,height=700');
    } catch (err) {
      console.error('Connect Gmail Error:', err);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!auth.currentUser?.email) return;
    setPasswordResetSent(false);
    setPasswordResetError(false);
    try {
      const { sendPasswordResetEmail } = await import('firebase/auth');
      await sendPasswordResetEmail(auth, auth.currentUser.email);
      setPasswordResetSent(true);
      setTimeout(() => setPasswordResetSent(false), 5000);
    } catch (err) {
      setPasswordResetError(true);
      setTimeout(() => setPasswordResetError(false), 5000);
    }
  };

  const toggleNotifications = async () => {
    if (!auth.currentUser) return;
    setNotificationError(null);
    if (!userProfile?.notificationsEnabled) {
      if (!('Notification' in window)) {
        setNotificationError('Ваш браузер не поддерживает уведомления.');
        return;
      }
      try {
        const permission = await Notification.requestPermission();
        setPermissionStatus(permission);
        if (permission !== 'granted') {
          setNotificationError('Разрешите уведомления в настройках браузера.');
          return;
        }
      } catch (e) {
        setNotificationError('Не удалось запросить разрешение.');
        return;
      }
    }
    setIsUpdatingNotifications(true);
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        notificationsEnabled: !userProfile?.notificationsEnabled
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${auth.currentUser.uid}`);
    } finally {
      setIsUpdatingNotifications(false);
    }
  };

  const checkPermissionManually = async () => {
    if (!('Notification' in window)) return;
    setNotificationError(null);
    const permission = await Notification.requestPermission();
    setPermissionStatus(permission);
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">Настройки</h2>

      {/* Roblox Profile */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 text-zinc-400 dark:text-zinc-500">
          <Shield className="w-5 h-5" />
          <h3 className="font-black uppercase tracking-widest text-[10px]">Профиль Roblox</h3>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 p-8 shadow-[0_8px_30px_rgba(0,0,0,0.02)]">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-zinc-900 dark:text-white mb-3">
                Никнейм Roblox
              </label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={robloxNickname}
                  onChange={(e) => setRobloxNickname(e.target.value)}
                  placeholder="Введите ваш никнейм"
                  className="flex-1 px-5 py-3 bg-zinc-50/50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 rounded-2xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-zinc-900 dark:text-white font-medium"
                />
                <button
                  onClick={handleSaveNickname}
                  disabled={isSavingNickname || robloxNickname === userProfile?.robloxNickname}
                  className="px-8 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all disabled:opacity-50 shadow-lg shadow-blue-600/20 active:scale-95"
                >
                  {isSavingNickname ? '...' : 'Сохранить'}
                </button>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-3 leading-relaxed">
                Приложение будет искать письма от <span className="font-mono font-bold text-blue-600 dark:text-blue-400">accounts@roblox.com</span>, содержащие этот никнейм.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Gmail */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 text-zinc-400 dark:text-zinc-500">
          <Mail className="w-5 h-5" />
          <h3 className="font-black uppercase tracking-widest text-[10px]">Подключение почты</h3>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 p-8 shadow-[0_8px_30px_rgba(0,0,0,0.02)]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="flex-1">
              <p className="font-bold text-zinc-900 dark:text-white text-lg">Google Gmail</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                {userProfile?.googleAccessToken
                  ? 'Почта успешно подключена. Мониторинг активен.'
                  : 'Подключите Gmail для автоматического поиска писем с кодами.'}
              </p>
            </div>
            <button
              onClick={handleConnectGmail}
              disabled={isConnecting}
              className={clsx(
                "px-8 py-3 rounded-2xl font-bold transition-all flex-shrink-0 text-sm active:scale-95",
                userProfile?.googleAccessToken
                  ? "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 border border-green-100 dark:border-green-800 hover:bg-green-100"
                  : "bg-blue-600 text-white hover:bg-blue-700 shadow-[0_8px_20px_rgba(37,99,235,0.2)]"
              )}
            >
              {isConnecting ? 'Загрузка...' : userProfile?.googleAccessToken ? 'Переподключить' : 'Подключить Gmail'}
            </button>
          </div>
        </div>
      </section>

      {/* Notifications */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 text-zinc-400 dark:text-zinc-500">
          <Bell className="w-5 h-5" />
          <h3 className="font-black uppercase tracking-widest text-[10px]">Уведомления</h3>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 p-8 shadow-[0_8px_30px_rgba(0,0,0,0.02)]">
          <div className="space-y-6">
            {permissionStatus === 'denied' ? (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                  <div className="flex-1">
                    <p className="font-bold text-red-600 dark:text-red-500 text-lg">Браузер блокирует уведомления</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                      Разрешите уведомления в настройках браузера.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 min-w-[180px]">
                    <button
                      onClick={checkPermissionManually}
                      className="px-4 py-2 bg-blue-600 text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Проверить
                    </button>
                    <button
                      onClick={() => window.open(window.location.href, '_blank')}
                      className="px-4 py-2 bg-zinc-50/50 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-zinc-100 transition-all flex items-center justify-center gap-2 border border-zinc-100 dark:border-zinc-700"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Новая вкладка
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                  <div className="flex-1">
                    <p className="font-bold text-zinc-900 dark:text-white text-lg">Статус уведомлений</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                      {userProfile?.notificationsEnabled
                        ? 'Уведомления включены.'
                        : 'Уведомления выключены.'}
                    </p>
                  </div>
                  <button
                    onClick={toggleNotifications}
                    disabled={isUpdatingNotifications || !('Notification' in window)}
                    className={clsx(
                      "px-8 py-3 rounded-2xl font-bold transition-all flex-shrink-0 text-sm active:scale-95",
                      userProfile?.notificationsEnabled
                        ? "bg-red-50 text-red-600 dark:bg-red-900/10 dark:text-red-400 border border-red-100 dark:border-red-800 hover:bg-red-100"
                        : "bg-blue-600 text-white hover:bg-blue-700 shadow-[0_8px_20px_rgba(37,99,235,0.2)]"
                    )}
                  >
                    {isUpdatingNotifications ? '...' : userProfile?.notificationsEnabled ? 'Выключить' : 'Включить'}
                  </button>
                </div>
                {notificationError && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs rounded-xl border border-red-100 dark:border-red-900/30 font-medium">
                    {notificationError}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Theme */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
          <Palette className="w-5 h-5" />
          <h3 className="font-bold uppercase tracking-wider text-xs">Внешний вид</h3>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {themeOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => setTheme(option.id)}
              className={clsx(
                "flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all",
                theme === option.id
                  ? "bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400"
                  : "bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700"
              )}
            >
              <option.icon className="w-6 h-6" />
              <span className="text-sm font-medium">{option.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Security */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
          <Shield className="w-5 h-5" />
          <h3 className="font-bold uppercase tracking-wider text-xs">Безопасность и Аккаунт</h3>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-bold dark:text-white">Пароль</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Сбросить пароль через Email</p>
            </div>
            <div className="flex items-center gap-3">
              {passwordResetSent && (
                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm font-bold">
                  <CheckCircle className="w-4 h-4" />
                  Отправлено!
                </div>
              )}
              {passwordResetError && (
                <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400 text-sm font-bold">
                  <AlertCircle className="w-4 h-4" />
                  Ошибка
                </div>
              )}
              <button
                onClick={handleResetPassword}
                disabled={passwordResetSent}
                className="text-sm font-bold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
              >
                Сбросить
              </button>
            </div>
          </div>

          <div className="h-px bg-zinc-100 dark:bg-zinc-800" />

          <div>
            <p className="font-bold text-red-600 dark:text-red-400 mb-2">Опасная зона</p>
            <button
              onClick={() => setShowConfirm(true)}
              className="w-full flex items-center justify-center gap-2 py-3 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 font-bold rounded-xl hover:bg-red-100 dark:hover:bg-red-900/20 transition-all border border-red-100 dark:border-red-900/20"
            >
              <Trash2 className="w-5 h-5" />
              Удалить аккаунт
            </button>
          </div>
        </div>
      </section>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-md w-full shadow-2xl border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-center w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full mb-6 mx-auto">
              <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            <h3 className="text-xl font-bold text-center dark:text-white mb-2">Вы уверены?</h3>
            <p className="text-zinc-500 dark:text-zinc-400 text-center mb-8">
              Это действие необратимо. Все ваши данные будут удалены навсегда.
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white font-bold rounded-xl hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
              >
                Отмена
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all disabled:opacity-50"
              >
                {isDeleting ? 'Удаление...' : 'Да, удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
