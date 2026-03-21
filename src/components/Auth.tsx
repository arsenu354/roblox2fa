import React, { useState } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  sendPasswordResetEmail 
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  collection, 
  query, 
  where, 
  getDocs 
} from 'firebase/firestore';
import { ShieldCheck, User, Mail, Lock, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';

export function Auth() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleResetPassword = async () => {
    if (!email) {
      setError('Пожалуйста, введите Email для сброса пароля.');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
      setError('Инструкции по сбросу пароля отправлены на вашу почту. Если письмо не пришло, проверьте папку "Спам".');
    } catch (err: any) {
      console.error('Reset Password Error:', err);
      setError('Не удалось отправить письмо для сброса пароля. Проверьте Email.');
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const cleanNickname = nickname.trim();
    const cleanEmail = email.trim().toLowerCase();

    try {
      if (isRegister) {
        // Check if nickname already exists (proactive check)
        let nicknameSnapshot;
        try {
          const nicknameQuery = query(collection(db, 'users'), where('robloxNickname', '==', cleanNickname));
          nicknameSnapshot = await getDocs(nicknameQuery);
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, 'users');
          return; // Should not reach here as handleFirestoreError throws
        }

        if (!nicknameSnapshot.empty) {
          throw { code: 'roblox/nickname-taken' };
        }

        // Register
        const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        try {
          await setDoc(doc(db, 'users', userCredential.user.uid), {
            uid: userCredential.user.uid,
            email: cleanEmail,
            robloxNickname: cleanNickname,
            createdAt: new Date().toISOString()
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${userCredential.user.uid}`);
        }
      } else {
        // Login directly with Email
        await signInWithEmailAndPassword(auth, cleanEmail, password);
      }
    } catch (err: any) {
      const errCode = err.code || '';
      const errMessage = (err.message || '').toLowerCase();
      const errString = String(err).toLowerCase();

      const isEmailInUse = errCode === 'auth/email-already-in-use' || errString.includes('email-already-in-use') || errMessage.includes('email-already-in-use');
      const isInvalidCredential = errCode === 'auth/invalid-credential' || errString.includes('invalid-credential') || errMessage.includes('invalid-credential');
      const isUserNotFound = errCode === 'auth/user-not-found' || errString.includes('user-not-found') || errMessage.includes('user-not-found');
      const isWrongPassword = errCode === 'auth/wrong-password' || errString.includes('wrong-password') || errMessage.includes('wrong-password');
      const isInvalidEmail = errCode === 'auth/invalid-email' || errString.includes('invalid-email') || errMessage.includes('invalid-email');
      const isWeakPassword = errCode === 'auth/weak-password' || errString.includes('weak-password') || errMessage.includes('weak-password');
      const isTooManyRequests = errCode === 'auth/too-many-requests' || errString.includes('too-many-requests') || errMessage.includes('too-many-requests');
      const isNicknameTaken = errCode === 'roblox/nickname-taken' || errString.includes('nickname-taken') || errMessage.includes('nickname-taken');
      const isNetworkError = errCode === 'auth/network-request-failed' || errString.includes('network-request-failed') || errMessage.includes('network-request-failed');
      const isOperationNotAllowed = errCode === 'auth/operation-not-allowed' || errString.includes('operation-not-allowed') || errMessage.includes('operation-not-allowed');

      const isHandledError = isEmailInUse || isInvalidCredential || isUserNotFound || isWrongPassword || isInvalidEmail || isWeakPassword || isTooManyRequests || isNicknameTaken || isNetworkError || isOperationNotAllowed;

      if (!isHandledError) {
        console.error('Auth Error:', err);
      }
      
      let message = 'Произошла ошибка при авторизации.';
      
      if (isEmailInUse) {
        message = 'Этот Email уже зарегистрирован. Пожалуйста, войдите в аккаунт.';
        setIsRegister(false);
      } else if (isInvalidEmail) {
        message = 'Некорректный адрес электронной почты.';
      } else if (isWeakPassword) {
        message = 'Пароль должен содержать минимум 6 символов.';
      } else if (isWrongPassword || isUserNotFound || isInvalidCredential) {
        message = 'Неверный Email или пароль.';
      } else if (isTooManyRequests) {
        message = 'Слишком много попыток. Пожалуйста, попробуйте позже.';
      } else if (isNicknameTaken) {
        message = 'Этот никнейм Roblox уже занят в нашей системе.';
      } else if (isNetworkError) {
        message = 'Ошибка сети. Проверьте подключение к интернету.';
      } else if (isOperationNotAllowed) {
        message = 'Вход по Email/Паролю не включен в консоли Firebase. Пожалуйста, включите его в разделе Authentication -> Sign-in method.';
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-3xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-8"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-500/20">
            <ShieldCheck className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold dark:text-white">Roblox2FA</h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
            {isRegister ? 'Создайте аккаунт для защиты' : 'Войдите в свой аккаунт'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-3 text-red-600 dark:text-red-400 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 ml-1 uppercase tracking-wider">Email</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all dark:text-white"
                placeholder="name@example.com"
              />
            </div>
          </div>

          {isRegister && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 ml-1 uppercase tracking-wider">Nickname Roblox</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
                <input
                  type="text"
                  required
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all dark:text-white"
                  placeholder=""
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 ml-1 uppercase tracking-wider">Пароль</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-12 pr-12 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all dark:text-white"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {!isRegister && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleResetPassword}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
              >
                Забыли пароль?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
          >
            {loading ? 'Загрузка...' : isRegister ? 'Зарегистрироваться' : 'Войти'}
          </button>
        </form>

        <div className="mt-8 text-center">
          <button
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
            }}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {isRegister ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
