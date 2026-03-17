const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/accounts: Lấy tất cả hoặc tìm kiếm (với filter role & status)
router.get('/', async (req, res) => {
    const query = req.query._q;
    const role = req.query.role;
    const status = req.query.status;

    let sql = `
        SELECT maTK, tenDangNhap, vaiTro, trangThai, lastLogin, createdAt
        FROM taikhoan
    `;
    let params = [];
    let whereClause = '';

    // Filter role
    if (role) {
        whereClause = ' WHERE vaiTro = ?';
        params.push(role);
    }

    // Filter status
    if (status) {
        if (whereClause) {
            whereClause += ' AND trangThai = ?';
        } else {
            whereClause = ' WHERE trangThai = ?';
        }
        params.push(status);
    }

    // Filter query (_q)
    if (query) {
        const queryCondition = '(tenDangNhap LIKE ? OR maTK LIKE ?)';
        if (whereClause) {
            whereClause += ' AND ' + queryCondition;
        } else {
            whereClause = ' WHERE ' + queryCondition;
        }
        params.push(`%${query}%`, `%${query}%`);
    }

    sql += whereClause + ' ORDER BY vaiTro, maTK';

    try {
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    } catch (err) {
        console.error('LỖI KHI TẢI TÀI KHOẢN:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải dữ liệu' });
    }
});

// GET /api/accounts/:maTK: Lấy thông tin chi tiết
router.get('/:maTK', async (req, res) => {
    const { maTK } = req.params;
    const sql = 'SELECT maTK, tenDangNhap, vaiTro, trangThai, lastLogin, createdAt FROM taikhoan WHERE maTK = ?';

    try {
        const [rows] = await db.execute(sql, [maTK]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error('LỖI KHI TẢI CHI TIẾT TÀI KHOẢN:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải dữ liệu' });
    }
});

// POST /api/accounts: Thêm tài khoản
router.post('/', async (req, res) => {
    const { maTK, tenDangNhap, matKhau, vaiTro } = req.body;

    if (!maTK || !tenDangNhap || !matKhau || !vaiTro) {
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc!' });
    }

    const validRoles = ['Admin', 'SinhVien', 'GiangVien'];
    if (!validRoles.includes(vaiTro)) {
        return res.status(400).json({ message: 'Vai trò không hợp lệ!' });
    }

    const sql = `
        INSERT INTO taikhoan (maTK, tenDangNhap, matKhau, vaiTro, trangThai, createdAt) 
        VALUES (?, ?, ?, ?, 'active', NOW())
    `;

    try {
        await db.execute(sql, [maTK, tenDangNhap, matKhau, vaiTro]);

        // Log activity
        await db.execute(
            'INSERT INTO activity_log (maTK, hoatDong, chiTiet) VALUES (?, ?, ?)',
            [maTK, 'Tạo tài khoản', `Tài khoản ${vaiTro} được tạo`]
        );

        res.status(201).json({
            message: 'Thêm tài khoản thành công',
            data: { maTK, tenDangNhap, vaiTro, trangThai: 'active' }
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Mã TK hoặc Tên đăng nhập đã tồn tại!' });
        }
        console.error('LỖI KHI THÊM TÀI KHOẢN:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi thêm dữ liệu' });
    }
});

// POST /api/accounts/:maTK/verify-password: Xác thực mật khẩu
router.post('/:maTK/verify-password', async (req, res) => {
    const { maTK } = req.params;
    const { currentPassword } = req.body;

    if (!currentPassword) {
        return res.status(400).json({ message: 'Thiếu mật khẩu hiện tại' });
    }

    try {
        const [rows] = await db.execute('SELECT matKhau FROM taikhoan WHERE maTK = ?', [maTK]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
        }

        const isValid = currentPassword === rows[0].matKhau;
        res.json({ valid: isValid });
    } catch (err) {
        console.error('LỖI XÁC THỰC MẬT KHẨU:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// PUT /api/accounts/:maTK: Cập nhật tài khoản
router.put('/:maTK', async (req, res) => {
    const { maTK } = req.params;
    const { tenDangNhap, matKhau, vaiTro, trangThai } = req.body;

    if (!tenDangNhap && !matKhau && !vaiTro && !trangThai) {
        return res.status(400).json({ message: 'Không có trường nào để cập nhật' });
    }

    // Validate role if provided
    if (vaiTro) {
        const validRoles = ['Admin', 'SinhVien', 'GiangVien'];
        if (!validRoles.includes(vaiTro)) {
            return res.status(400).json({ message: 'Vai trò không hợp lệ!' });
        }
    }

    // Validate status if provided
    if (trangThai && !['active', 'locked'].includes(trangThai)) {
        return res.status(400).json({ message: 'Trạng thái không hợp lệ!' });
    }

    let updateFields = [];
    let params = [];

    if (tenDangNhap !== undefined) {
        updateFields.push('tenDangNhap = ?');
        params.push(tenDangNhap);
    }

    if (matKhau !== undefined && matKhau !== '') {
        updateFields.push('matKhau = ?');
        params.push(matKhau);
    }

    if (vaiTro !== undefined) {
        updateFields.push('vaiTro = ?');
        params.push(vaiTro);
    }

    if (trangThai !== undefined) {
        updateFields.push('trangThai = ?');
        params.push(trangThai);
    }

    updateFields.push('updatedAt = NOW()');
    params.push(maTK);

    const sql = `UPDATE taikhoan SET ${updateFields.join(', ')} WHERE maTK = ?`;

    try {
        const [result] = await db.execute(sql, params);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
        }

        // Log activity if status changed
        if (trangThai !== undefined) {
            await db.execute(
                'INSERT INTO activity_log (maTK, hoatDong, chiTiet) VALUES (?, ?, ?)',
                [maTK, 'Thay đổi trạng thái', `Trạng thái: ${trangThai}`]
            );
        }

        res.json({
            message: 'Cập nhật tài khoản thành công',
            affectedRows: result.affectedRows
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại!' });
        }
        console.error('LỖI KHI CẬP NHẬT TÀI KHOẢN:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi cập nhật dữ liệu' });
    }
});

router.delete('/:maTK', async (req, res) => {
    const { maTK } = req.params;

    try {
        // ✅ Kiểm tra tồn tại
        const [checkRows] = await db.execute(
            'SELECT maTK, vaiTro FROM taikhoan WHERE maTK = ?',
            [maTK]
        );

        if (checkRows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
        }

        const account = checkRows[0];

        // ✅ Log trước khi xóa
        try {
            await db.execute(
                'INSERT INTO activity_log (maTK, hoatDong, chiTiet) VALUES (?, ?, ?)',
                [maTK, 'Xóa tài khoản', `Tài khoản ${account.vaiTro} đã được xóa`]
            );
        } catch (logErr) {
            console.warn('⚠️ Không thể log activity:', logErr.message);
        }

        // ✅ Xóa tài khoản
        await db.execute('DELETE FROM taikhoan WHERE maTK = ?', [maTK]);

        // ✅ CHỈ GỬI 1 response duy nhất
        return res.json({
            message: 'Xóa tài khoản thành công',
            deletedAccount: account
        });

    } catch (err) {
        console.error('❌ LỖI XÓA TÀI KHOẢN:', err.message, err.code);

        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({
                message: 'Không thể xóa tài khoản này vì đang liên kết với Sinh viên hoặc Giảng viên'
            });
        }

        // ✅ Trả về lỗi chi tiết
        return res.status(500).json({
            message: 'Lỗi máy chủ khi xóa dữ liệu',
            error: err.message
        });
    }
});

// PUT /api/accounts/:maTK/toggle-status: Chuyển đổi trạng thái (khóa/mở khóa)
router.put('/:maTK/toggle-status', async (req, res) => {
    const { maTK } = req.params;
    const { trangThai } = req.body;

    if (!['active', 'locked'].includes(trangThai)) {
        return res.status(400).json({ message: 'Trạng thái không hợp lệ!' });
    }

    const sql = 'UPDATE taikhoan SET trangThai = ? WHERE maTK = ?';

    try {
        const [result] = await db.execute(sql, [trangThai, maTK]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
        }

        // Log activity
        const hoatDong = trangThai === 'locked' ? 'Khóa tài khoản' : 'Mở khóa tài khoản';
        await db.execute(
            'INSERT INTO activity_log (maTK, hoatDong, chiTiet) VALUES (?, ?, ?)',
            [maTK, hoatDong, `Tài khoản được ${hoatDong.toLowerCase()}`]
        );

        res.json({
            message: `${hoatDong} thành công`,
            maTK,
            trangThai
        });
    } catch (err) {
        console.error('LỖI KHI THAY ĐỔI TRẠNG THÁI:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi cập nhật trạng thái' });
    }
});

// GET /api/accounts/:maTK/activity: Lấy lịch sử hoạt động
router.get('/:maTK/activity', async (req, res) => {
    const { maTK } = req.params;
    const sql = `
        SELECT id, hoatDong, chiTiet, thoiGian 
        FROM activity_log 
        WHERE maTK = ? 
        ORDER BY thoiGian DESC 
        LIMIT 50
    `;

    try {
        const [rows] = await db.execute(sql, [maTK]);
        res.json(rows);
    } catch (err) {
        console.error('LỖI KHI TẢI LỊCH SỬ HOẠT ĐỘNG:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải lịch sử' });
    }
});

// POST /api/accounts/bulk-delete: Xóa nhiều tài khoản
router.post('/bulk-delete', async (req, res) => {
    const { maTKList } = req.body;

    if (!maTKList || !Array.isArray(maTKList) || maTKList.length === 0) {
        return res.status(400).json({ message: 'Danh sách mã TK không hợp lệ' });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        let deletedCount = 0;
        let failedList = [];

        for (const maTK of maTKList) {
            try {
                const [result] = await connection.execute(
                    'DELETE FROM taikhoan WHERE maTK = ?',
                    [maTK]
                );
                if (result.affectedRows > 0) {
                    deletedCount++;
                    await connection.execute(
                        'INSERT INTO activity_log (maTK, hoatDong, chiTiet) VALUES (?, ?, ?)',
                        [maTK, 'Xóa tài khoản (hàng loạt)', 'Xóa thông qua chức năng hàng loạt']
                    );
                }
            } catch (err) {
                failedList.push({ maTK, error: err.message });
            }
        }

        await connection.commit();

        res.json({
            message: `Đã xóa ${deletedCount}/${maTKList.length} tài khoản`,
            deletedCount,
            totalRequested: maTKList.length,
            failed: failedList
        });

    } catch (err) {
        await connection.rollback();
        console.error('LỖI KHI XÓA HÀNG LOẠT:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi xóa hàng loạt' });
    } finally {
        connection.release();
    }
});

// GET /api/accounts/stats/overview: Lấy thống kê tài khoản
router.get('/stats/overview', async (req, res) => {
    try {
        const [stats] = await db.execute(`
            SELECT 
                COUNT(*) as totalAccounts,
                SUM(CASE WHEN vaiTro = 'Admin' THEN 1 ELSE 0 END) as totalAdmins,
                SUM(CASE WHEN vaiTro = 'SinhVien' THEN 1 ELSE 0 END) as totalStudents,
                SUM(CASE WHEN vaiTro = 'GiangVien' THEN 1 ELSE 0 END) as totalTeachers,
                SUM(CASE WHEN trangThai = 'active' THEN 1 ELSE 0 END) as totalActive,
                SUM(CASE WHEN trangThai = 'locked' THEN 1 ELSE 0 END) as totalLocked
            FROM taikhoan
        `);

        res.json(stats[0]);
    } catch (err) {
        console.error('LỖI KHI TẢI THỐNG KÊ:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải thống kê' });
    }
});

module.exports = router;