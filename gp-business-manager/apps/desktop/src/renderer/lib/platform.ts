/** `true` quand l'interface tourne dans un navigateur (site web / téléphone) et non dans l'application Windows. */
export const isWeb = typeof window !== 'undefined' && window.gp?.platform === 'web';
