import React from 'react';
import { ShieldCheck, Mail, User, Github, Globe } from 'lucide-react';

export function Info() {
  return (
    <div className="space-y-12 max-w-3xl">
      <div className="space-y-4">
        <h2 className="text-4xl font-black text-zinc-900 dark:text-white tracking-tight">Roblox2FA</h2>
        <p className="text-xl text-zinc-500 dark:text-zinc-400 font-medium leading-relaxed">
          Безопасный и быстрый способ получения кодов двухфакторной аутентификации Roblox прямо в вашем браузере.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-8 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 shadow-[0_8px_30px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.05)] transition-all">
          <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center mb-6">
            <Mail className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-3">Авто-синхронизация</h3>
          <p className="text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Приложение автоматически проверяет вашу почту каждые 5 секунд и мгновенно отображает новые коды подтверждения.
          </p>
        </div>

        <div className="p-8 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 shadow-[0_8px_30px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.05)] transition-all">
          <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-2xl flex items-center justify-center mb-6">
            <ShieldCheck className="w-6 h-6 text-green-600 dark:text-green-400" />
          </div>
          <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-3">Умные уведомления</h3>
          <p className="text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Получайте push-уведомления с кодом, который можно скопировать одним нажатием, даже если вкладка закрыта.
          </p>
        </div>
      </div>

      <div className="space-y-8">
        <h3 className="text-2xl font-bold text-zinc-900 dark:text-white">Как это работает?</h3>
        <div className="space-y-6">
          {[
            { step: '01', title: 'Подключение', text: 'Вы подключаете свой Gmail аккаунт через безопасную авторизацию Google.' },
            { step: '02', title: 'Мониторинг', text: 'Приложение ищет письма от Roblox, адресованные вашему никнейму.' },
            { step: '03', title: 'Получение', text: 'Как только код приходит, он мгновенно появляется в списке и в уведомлении.' },
          ].map((item) => (
            <div key={item.step} className="flex gap-6 p-6 bg-zinc-50/50 dark:bg-zinc-900/50 rounded-2xl border border-zinc-100 dark:border-zinc-800">
              <span className="text-3xl font-black text-blue-600/20 dark:text-blue-400/20">{item.step}</span>
              <div>
                <h4 className="font-bold text-zinc-900 dark:text-white mb-1">{item.title}</h4>
                <p className="text-zinc-500 dark:text-zinc-400 text-sm leading-relaxed">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-8 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-6">
        <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors font-medium">
          <Github className="w-5 h-5" />
          <span>GitHub</span>
        </a>
        <a href="https://roblox.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors font-medium">
          <Globe className="w-5 h-5" />
          <span>Сайт</span>
        </a>
      </div>
    </div>
  );
}
