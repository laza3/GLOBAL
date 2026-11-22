/**
 * Contrôle d'origine (anti-CSRF et CORS) : l'origine d'une requête doit figurer dans ALLOWED_ORIGINS. En mode réseau local
 * (LAN_MODE, installation sur l'ordinateur d'un hôtel) les origines du réseau PRIVÉ sont aussi acceptées, car l'adresse de
 * l'ordinateur principal change selon le réseau (box Wi-Fi, point d'accès du PC…) : une origine d'Internet (https://autre-site.com)
 * reste toujours refusée.
 */
export function isPrivateNetworkOrigin(origin: string): boolean {
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/') return false;
  const host = url.hostname.toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return false;
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  // Nom d'ordinateur du réseau local : « RECEPTION », « pc-hotel.local » (jamais un nom de domaine d'Internet)
  return host === 'localhost' || /^[a-z0-9][a-z0-9_-]*$/.test(host) || /^[a-z0-9][a-z0-9.-]*\.local$/.test(host);
}

export function isOriginAllowed(config: { allowedOrigins: string[]; LAN_MODE: boolean }, origin: string): boolean {
  return config.allowedOrigins.includes(origin) || (config.LAN_MODE && isPrivateNetworkOrigin(origin));
}
