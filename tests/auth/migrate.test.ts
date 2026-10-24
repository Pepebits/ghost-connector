import { describe, expect, it } from 'vitest';
import { checkSession, createSession, findUser, totpEnabled, verifyLogin } from '../../src/auth/store.js';
import { getDb, migrateSingleUser } from '../../src/db/index.js';
import { hashPassword } from '../../src/auth/store.js';

describe('migration from single login to users', () => {
  it('the previous password and 2FA move to "admin", who becomes owner', async () => {
    const db = getDb();
    const set = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    set.run('auth_password_hash', await hashPassword('la frase de antes'));
    set.run('auth_totp_secret', 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
    db.prepare("INSERT INTO auth_sessions (id_hash, created_at, expires_at, last_seen) VALUES ('viejo', 'x', '2999-01-01', 'x')").run();
    migrateSingleUser(db);

    const admin = findUser('admin')!;
    expect(admin.role).toBe('owner');
    expect(totpEnabled(admin.id)).toBe(true);
    expect(await verifyLogin('admin', 'la frase de antes')).not.toBeNull();
    expect(db.prepare("SELECT user_id FROM auth_sessions WHERE id_hash = 'viejo'").get()).toEqual({ user_id: admin.id });
    expect(db.prepare("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'auth_%'").get()).toEqual({ n: 0 });

    migrateSingleUser(db); // idempotent
    expect(checkSession(createSession(admin.id).token)?.username).toBe('admin');
  });
});
