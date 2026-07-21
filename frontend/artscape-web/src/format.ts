export const money = (value: string | number | undefined, compact = false): string => {
  const amount = Number(value ?? 0);
  if (compact) {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(amount);
  }
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(amount);
};

export const percent = (value: string | number | undefined, digits = 1): string =>
  `${(Number(value ?? 0) * 100).toFixed(digits)}%`;

export const shortId = (value: string | undefined): string =>
  value ? `${value.slice(0, 12)}…${value.slice(-4)}` : '—';

export const dateTime = (value: string | undefined): string =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : '—';
