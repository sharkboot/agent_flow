import clsx from '@/utils/clsx';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        'w-full px-3 py-2 rounded-md border border-slate-300 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20',
        props.className,
      )}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(
        'w-full px-3 py-2 rounded-md border border-slate-300 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-y',
        props.className,
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        'w-full px-3 py-2 rounded-md border border-slate-300 text-sm bg-white outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20',
        props.className,
      )}
    />
  );
}

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-slate-600 mb-1 block">
      {children}
    </label>
  );
}
