// routes/auth.js - Simple: So sánh SHA256 trực tiếp

const express = require('express');
const router = express.Router();
const db = require('../config/db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { tenDangNhap, matKhau } = req.body;

    console.log('\n=== LOGIN ===');
    console.log('Username:', tenDangNhap);
    console.log('Password hash (from client):', matKhau);

    if (!tenDangNhap || !matKhau) {
        return res.status(400).json({ 
            message: 'Vui lòng nhập Tên đăng nhập và Mật khẩu.' 
        });
    }

    const sql = `
        SELECT maTK, tenDangNhap, matKhau, vaiTro, trangThai
        FROM taikhoan 
        WHERE tenDangNhap = ?
    `;

    try {
        const [rows] = await db.execute(sql, [tenDangNhap]);

        if (rows.length === 0) {
            console.log('❌ Username không tồn tại');
            return res.status(401).json({ 
                message: 'Tên đăng nhập hoặc mật khẩu không đúng.' 
            });
        }

        const user = rows[0];
        console.log('User found:', user.maTK);
        console.log('Password hash (from DB):', user.matKhau);

        // Kiểm tra tài khoản bị khóa
        if (user.trangThai === 'locked') {
            console.log('❌ Account locked');
            return res.status(403).json({ 
                message: 'Tài khoản của bạn đã bị khóa.',
                isLocked: true
            });
        }

        // So sánh SHA256 trực tiếp
        if (matKhau !== user.matKhau) {
            console.log('❌ Password mismatch');
            return res.status(401).json({ 
                message: 'Tên đăng nhập hoặc mật khẩu không đúng.' 
            });
        }

        console.log('✓ Login successful');
        return res.status(200).json({
            success: true,
            message: 'Đăng nhập thành công',
            vaiTro: user.vaiTro, 
            maTK: user.maTK
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return res.status(500).json({ 
            message: 'Lỗi server' 
        });
    }
});

module.exports = router;