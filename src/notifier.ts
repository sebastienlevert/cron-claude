/**
 * Windows Toast Notification system
 * Sends notifications when tasks complete
 */

import notifier from 'node-notifier';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to the notification icon bundled with the package */
const ICON_PATH = resolve(__dirname, '..', 'assets', 'icon.png');

/**
 * Send a Windows toast notification.
 * If `openPath` is provided, clicking the notification opens that file in Obsidian.
 */
export async function sendNotification(
  title: string,
  message: string,
  openPath?: string,
): Promise<void> {
  const options: Record<string, unknown> = {
    title,
    message,
    icon: ICON_PATH,
    sound: true,
    wait: false,
    appID: 'cron-agents',
  };

  // Deep-link to the log file in Obsidian when clicked
  if (openPath) {
    options.open = `obsidian://open?path=${encodeURIComponent(openPath)}`;
  }

  return new Promise((resolve, reject) => {
    notifier.notify(options, (err, response) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Send success notification
 */
export async function notifySuccess(taskId: string, message?: string): Promise<void> {
  await sendNotification(
    `✓ Task Completed: ${taskId}`,
    message || 'Task executed successfully'
  );
}

/**
 * Send failure notification
 */
export async function notifyFailure(taskId: string, error?: string): Promise<void> {
  await sendNotification(
    `✗ Task Failed: ${taskId}`,
    error || 'Task execution failed'
  );
}
