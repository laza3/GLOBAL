import { createTemplate } from '@hmp/db/testing';

/** Une base « modèle » migrée par exécution ; chaque fichier de test en reçoit une copie isolée. */
export async function setup(): Promise<() => Promise<void>> {
  const template = await createTemplate();
  process.env.HMP_TEST_ADMIN_URL = template.adminUrl;
  process.env.HMP_TEST_TEMPLATE_DB = template.name;
  return () => template.drop();
}
