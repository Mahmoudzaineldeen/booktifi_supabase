/**
 * Global notification and confirmation helpers.
 * Use these instead of alert() / confirm() for a consistent in-app UI.
 */
export { showNotification } from '../contexts/NotificationContext';
export type { NotificationType } from '../contexts/NotificationContext';
export { showConfirm } from '../contexts/ConfirmContext';
export type { ConfirmOptions } from '../contexts/ConfirmContext';
