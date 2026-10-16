import { AppRouter } from './router';
import { NotificationStreamProvider } from './components/layout/NotificationStreamProvider';

export default function App() {
  return (
    <NotificationStreamProvider>
      <AppRouter />
    </NotificationStreamProvider>
  );
}
