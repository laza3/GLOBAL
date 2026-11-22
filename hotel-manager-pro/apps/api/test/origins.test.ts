import { describe, expect, it } from 'vitest';
import { isOriginAllowed, isPrivateNetworkOrigin } from '../src/lib/origins';

describe('origines du réseau local', () => {
  it('accepte les adresses privées et les noms d\'ordinateur du réseau local', () => {
    for (const o of ['http://192.168.1.20:5173', 'http://192.168.137.1:5173', 'http://10.0.0.5:5173', 'http://172.16.4.2:5173', 'http://172.31.255.1:5173', 'http://127.0.0.1:5173', 'http://localhost:5173', 'http://reception:5173', 'http://pc_hotel-2:5173', 'http://pc-hotel.local:5173']) {
      expect(isPrivateNetworkOrigin(o), o).toBe(true);
    }
  });
  it('refuse Internet, https, les adresses publiques et les astuces', () => {
    for (const o of ['https://evil.com', 'http://evil.com', 'http://8.8.8.8:5173', 'http://172.32.0.1', 'http://192.169.1.1', 'https://192.168.1.20', 'http://192.168.1.20@evil.com', 'http://192.168.1.999', 'http://192.168.1.20/chemin', 'null', '', 'http://evil.com.local.evil.com']) {
      expect(isPrivateNetworkOrigin(o), o).toBe(false);
    }
  });
  it('n\'ouvre rien sans LAN_MODE', () => {
    const base = { allowedOrigins: ['http://127.0.0.1:5173'] };
    expect(isOriginAllowed({ ...base, LAN_MODE: false }, 'http://192.168.1.20:5173')).toBe(false);
    expect(isOriginAllowed({ ...base, LAN_MODE: true }, 'http://192.168.1.20:5173')).toBe(true);
    expect(isOriginAllowed({ ...base, LAN_MODE: true }, 'https://evil.com')).toBe(false);
    expect(isOriginAllowed({ ...base, LAN_MODE: false }, 'http://127.0.0.1:5173')).toBe(true);
  });
});
