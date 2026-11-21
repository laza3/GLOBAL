import { useDocumentTitle } from '../../lib/use-title';
import { SupportPanel } from './support-panel';

export default function SupportPage() {
  useDocumentTitle('Assistance');
  return <SupportPanel />;
}
