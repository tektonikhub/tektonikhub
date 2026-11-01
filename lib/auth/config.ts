export function insforgeOptions() {
  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  if (!baseUrl || !anonKey) throw new Error('Falta la configuración de autenticación de la aplicación.');
  return { baseUrl, anonKey };
}
export function appUrl(): string {
  const value = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!value) throw new Error('Falta NEXT_PUBLIC_APP_URL para los enlaces de acceso.');
  return new URL(value).origin;
}
export const cookieSettings = {
  options: {
    accessToken: { secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const },
    refreshToken: { secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const },
  },
};
