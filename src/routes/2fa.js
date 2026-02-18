
const express = require('express');
const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const crypto = require('crypto');
const { getConnection } = require('../db/connection');
const { auth } = require('../middleware/auth');

const router = express.Router();

// 所有路由都需要身份验证
router.use(auth);

// 生成备用代码
function generateBackupCodes(count = 8) {
    const codes = [];
    for (let i = 0; i < count; i++) {
        // 生成 8 位随机备用代码
        const code = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 8);
        codes.push(code);
    }
    return codes;
}

/**
 * GET /api/2fa/status
 * 获取当前用户的2FA状态
 */
router.get('/status', async (req, res) => {
    console.log('[2FA Status] Request received');
    console.log('[2FA Status] req.user:', req.user);
    
    try {
        const db = getConnection();
        const user = await db.get('SELECT tfa_enabled, tfa_secret, tfa_backup_codes FROM users WHERE username = ?', [req.user]);
        console.log('[2FA Status] User:', user);
        
        if (!user) {
            console.log('[2FA Status] User not found');
            return res.status(404).json({ message: '用户不存在' });
        }
        
        let backupCodes = null;
        if (user.tfa_backup_codes) {
            try {
                backupCodes = JSON.parse(user.tfa_backup_codes);
            } catch (e) {
                console.error('[2FA Status] 解析备用代码失败:', e);
            }
        }
        
        console.log('[2FA Status] Responding with enabled:', !!user.tfa_enabled);
        res.json({ enabled: !!user.tfa_enabled, backupCodes });
    } catch (e) {
        console.error('[2FA Status] 获取2FA状态失败:', e);
        res.status(500).json({ message: '服务器内部错误' });
    }
});

/**
 * POST /api/2fa/setup
 * 为用户生成一个新的2FA密钥和二维码
 */
router.post('/setup', async (req, res) => {
    console.log('[2FA Setup] Request received');
    console.log('[2FA Setup] req.user:', req.user);
    
    try {
        const db = getConnection();
        
        // 先检查用户是否已有 tfa_secret
        const existingUser = await db.get('SELECT tfa_secret, email FROM users WHERE username = ?', [req.user]);
        if (!existingUser) {
            console.log('[2FA Setup] User not found:', req.user);
            return res.status(404).json({ message: '用户不存在' });
        }

        let secret = existingUser.tfa_secret;
        
        // 只有在用户没有 tfa_secret 时才生成新的
        if (!secret) {
            secret = authenticator.generateSecret();
            console.log('[2FA Setup] Generated new secret:', secret);
            await db.run('UPDATE users SET tfa_secret = ? WHERE username = ?', [secret, req.user]);
        } else {
            console.log('[2FA Setup] Using existing secret:', secret);
        }

        const otpAuthUrl = authenticator.keyuri(req.user, 'z7note', secret);
        console.log('[2FA Setup] Generated otpAuthUrl:', otpAuthUrl);

        qrcode.toDataURL(otpAuthUrl, (err, qrCode) => {
            if (err) {
                console.error('[2FA Setup] 生成二维码失败:', err);
                return res.status(500).json({ message: '无法生成二维码' });
            }
            console.log('[2FA Setup] QR code generated successfully');
            res.json({ secret, qrCode });
        });
    } catch (e) {
        console.error('[2FA Setup] 设置2FA失败:', e);
        res.status(500).json({ message: '服务器内部错误' });
    }
});

/**
 * POST /api/2fa/enable
 * 验证令牌并为用户启用2FA
 */
router.post('/enable', async (req, res) => {
    console.log('[2FA Enable] Request received');
    console.log('[2FA Enable] req.body:', req.body);
    console.log('[2FA Enable] req.user:', req.user);
    
    const { token } = req.body;
    if (!token) {
        console.log('[2FA Enable] No token provided');
        return res.status(400).json({ message: '需要提供验证码' });
    }

    try {
        const db = getConnection();
        console.log('[2FA Enable] Querying user:', req.user);
        const user = await db.get('SELECT tfa_secret, tfa_enabled FROM users WHERE username = ?', [req.user]);

        console.log('[2FA Enable] User found:', user);

        if (!user || !user.tfa_secret) {
            console.log('[2FA Enable] User or secret missing');
            return res.status(400).json({ message: '2FA未设置或密钥丢失' });
        }

        console.log('[2FA Enable] Checking token:', token, 'with secret:', user.tfa_secret);
        
        // 验证 token，使用 ±2 步的窗口以增加容错性
        let isValid = false;
        const window = 2;
        for (let i = -window; i <= window; i++) {
            const delta = authenticator.verify({
                token,
                secret: user.tfa_secret,
                window: [i, i]
            });
            if (delta !== null) {
                isValid = true;
                break;
            }
        }
        
        console.log('[2FA Enable] Token valid:', isValid);

        if (isValid) {
            // 生成备用代码
            const backupCodes = generateBackupCodes();
            const backupCodesJson = JSON.stringify(backupCodes);
            
            // 更新用户记录
            await db.run(
                'UPDATE users SET tfa_enabled = 1, tfa_backup_codes = ? WHERE username = ?', 
                [backupCodesJson, req.user]
            );
            
            console.log('[2FA Enable] 2FA enabled successfully');
            res.json({ message: '2FA已成功启用', backupCodes });
        } else {
            console.log('[2FA Enable] Invalid token');
            res.status(400).json({ message: '验证码无效' });
        }
    } catch (e) {
        console.error('[2FA Enable] Error:', e);
        res.status(500).json({ message: '服务器内部错误' });
    }
});

/**
 * POST /api/2fa/disable
 * 为用户禁用2FA
 */
router.post('/disable', async (req, res) => {
    console.log('[2FA Disable] Request received');
    console.log('[2FA Disable] req.user:', req.user);
    
    try {
        const db = getConnection();
        // 同时禁用并清空密钥和备用代码
        await db.run(
            'UPDATE users SET tfa_enabled = 0, tfa_secret = NULL, tfa_backup_codes = NULL WHERE username = ?', 
            [req.user]
        );
        console.log('[2FA Disable] 2FA disabled successfully');
        res.json({ message: '2FA已成功禁用' });
    } catch (e) {
        console.error('[2FA Disable] 禁用2FA失败:', e);
        res.status(500).json({ message: '服务器内部错误' });
    }
});

/**
 * POST /api/2fa/refresh-backup-codes
 * 重新生成备用代码
 */
router.post('/refresh-backup-codes', async (req, res) => {
    console.log('[2FA Refresh Backup Codes] Request received');
    console.log('[2FA Refresh Backup Codes] req.user:', req.user);
    
    try {
        const db = getConnection();
        const user = await db.get('SELECT tfa_enabled FROM users WHERE username = ?', [req.user]);
        
        if (!user || !user.tfa_enabled) {
            return res.status(400).json({ message: '2FA未启用' });
        }
        
        const backupCodes = generateBackupCodes();
        const backupCodesJson = JSON.stringify(backupCodes);
        
        await db.run(
            'UPDATE users SET tfa_backup_codes = ? WHERE username = ?', 
            [backupCodesJson, req.user]
        );
        
        console.log('[2FA Refresh Backup Codes] Backup codes refreshed');
        res.json({ backupCodes });
    } catch (e) {
        console.error('[2FA Refresh Backup Codes] 刷新备用代码失败:', e);
        res.status(500).json({ message: '服务器内部错误' });
    }
});


module.exports = router;
