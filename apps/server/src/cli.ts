import { Database } from './db/database.js';
import { loadConfig } from './core/config.js';
import { createUser } from './modules/auth/index.js';
const config = await loadConfig();
const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PASSWORD;
if (!username || !password) {
  console.error(
    '请通过 ADMIN_USERNAME 和 ADMIN_PASSWORD 环境变量提供管理员凭据，不要将密码写入命令行。',
  );
  process.exitCode = 1;
} else {
  const db = await Database.open({
    driver: config.databaseDriver,
    database: config.databasePath,
    url: config.databaseUrl,
  });
  try {
    const user = await createUser(db, {
      username,
      password,
      displayName: process.env.ADMIN_DISPLAY_NAME,
      role: 'admin',
      mustChangePassword: false,
    });
    console.log('管理员已创建：' + user.username);
  } finally {
    await db.close();
  }
}
