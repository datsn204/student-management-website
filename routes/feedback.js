const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/feedback - Lấy tất cả phản hồi (cho Admin/GiangVien)
router.get('/', async (req, res) => {
    const { maSV, limit = 50, offset = 0 } = req.query;

    let sql = `
        SELECT 
            ph.id,
            ph.maSV,
            sv.hoTen,
            sv.maLop,
            lh.tenLop,
            ph.noiDung,
            ph.ngayGui,
            ph.phanHoiPhu
        FROM phanhoi ph
        LEFT JOIN sinhvien sv ON ph.maSV = sv.maSV
        LEFT JOIN lophoc lh ON sv.maLop = lh.maLop
    `;
    
    let params = [];
    
    if (maSV) {
        sql += ' WHERE ph.maSV = ?';
        params.push(maSV);
    }
    
    sql += ' ORDER BY ph.ngayGui DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    try {
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    } catch (err) {
        console.error('LỖI KHI TẢI PHẢN HỒI:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải dữ liệu' });
    }
});

// GET /api/feedback/:id - Lấy chi tiết một phản hồi
router.get('/:id', async (req, res) => {
    const { id } = req.params;

    const sql = `
        SELECT 
            ph.id,
            ph.maSV,
            sv.hoTen,
            sv.email,
            sv.sdt,
            sv.maLop,
            lh.tenLop,
            ph.noiDung,
            ph.ngayGui,
            ph.phanHoiPhu
        FROM phanhoi ph
        LEFT JOIN sinhvien sv ON ph.maSV = sv.maSV
        LEFT JOIN lophoc lh ON sv.maLop = lh.maLop
        WHERE ph.id = ?
    `;

    try {
        const [rows] = await db.execute(sql, [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy phản hồi' });
        }
        
        res.json(rows[0]);
    } catch (err) {
        console.error('LỖI KHI TẢI CHI TIẾT:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải dữ liệu' });
    }
});

// POST /api/feedback - Tạo phản hồi mới
router.post('/', async (req, res) => {
    const { maSV, noiDung } = req.body;

    if (!maSV || !noiDung) {
        return res.status(400).json({ 
            message: 'Thiếu thông tin bắt buộc: Mã SV và Nội dung!' 
        });
    }

    // Validate nội dung
    if (noiDung.trim().length < 10) {
        return res.status(400).json({ 
            message: 'Nội dung phản hồi phải có ít nhất 10 ký tự!' 
        });
    }

    if (noiDung.length > 1000) {
        return res.status(400).json({ 
            message: 'Nội dung phản hồi không được quá 1000 ký tự!' 
        });
    }

    const sql = `
        INSERT INTO phanhoi (maSV, noiDung, ngayGui) 
        VALUES (?, ?, NOW())
    `;

    try {
        // Kiểm tra sinh viên tồn tại
        const [checkSV] = await db.execute(
            'SELECT maSV FROM sinhvien WHERE maSV = ?', 
            [maSV]
        );

        if (checkSV.length === 0) {
            return res.status(404).json({ 
                message: 'Không tìm thấy sinh viên!' 
            });
        }

        const [result] = await db.execute(sql, [maSV, noiDung.trim()]);

        res.status(201).json({
            message: 'Gửi phản hồi thành công',
            id: result.insertId,
            data: {
                maSV,
                noiDung: noiDung.trim(),
                ngayGui: new Date()
            }
        });
    } catch (err) {
        console.error('LỖI KHI GỬI PHẢN HỒI:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi gửi phản hồi' });
    }
});

// PUT /api/feedback/:id/reply - Phản hồi lại (Admin/GiangVien)
router.put('/:id/reply', async (req, res) => {
    const { id } = req.params;
    const { phanHoiPhu } = req.body;

    if (!phanHoiPhu) {
        return res.status(400).json({ 
            message: 'Thiếu nội dung phản hồi!' 
        });
    }

    if (phanHoiPhu.trim().length < 10) {
        return res.status(400).json({ 
            message: 'Nội dung phản hồi phải có ít nhất 10 ký tự!' 
        });
    }

    const sql = `
        UPDATE phanhoi 
        SET phanHoiPhu = ? 
        WHERE id = ?
    `;

    try {
        const [result] = await db.execute(sql, [phanHoiPhu.trim(), id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                message: 'Không tìm thấy phản hồi' 
            });
        }

        res.json({
            message: 'Phản hồi thành công',
            id,
            phanHoiPhu: phanHoiPhu.trim()
        });
    } catch (err) {
        console.error('LỖI KHI PHẢN HỒI:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi phản hồi' });
    }
});

// DELETE /api/feedback/:id - Xóa phản hồi
router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Kiểm tra tồn tại
        const [checkRows] = await db.execute(
            'SELECT id, maSV FROM phanhoi WHERE id = ?',
            [id]
        );

        if (checkRows.length === 0) {
            return res.status(404).json({ 
                message: 'Không tìm thấy phản hồi' 
            });
        }

        const feedback = checkRows[0];

        // Xóa phản hồi
        await db.execute('DELETE FROM phanhoi WHERE id = ?', [id]);

        return res.json({
            message: 'Xóa phản hồi thành công',
            deletedFeedback: feedback
        });

    } catch (err) {
        console.error('LỖI XÓA PHẢN HỒI:', err.message, err.code);
        
        return res.status(500).json({
            message: 'Lỗi máy chủ khi xóa dữ liệu',
            error: err.message
        });
    }
});

// GET /api/feedback/stats/overview - Thống kê phản hồi
router.get('/stats/overview', async (req, res) => {
    try {
        const [stats] = await db.execute(`
            SELECT 
                COUNT(*) as totalFeedback,
                SUM(CASE WHEN phanHoiPhu IS NULL THEN 1 ELSE 0 END) as pendingFeedback,
                SUM(CASE WHEN phanHoiPhu IS NOT NULL THEN 1 ELSE 0 END) as repliedFeedback,
                COUNT(DISTINCT maSV) as totalStudents
            FROM phanhoi
        `);

        res.json(stats[0]);
    } catch (err) {
        console.error('LỖI KHI TẢI THỐNG KÊ:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải thống kê' });
    }
});

// GET /api/feedback/student/:maSV - Lấy phản hồi của sinh viên
router.get('/student/:maSV', async (req, res) => {
    const { maSV } = req.params;

    const sql = `
        SELECT 
            ph.id,
            ph.maSV,
            ph.noiDung,
            ph.ngayGui,
            ph.phanHoiPhu,
            CASE 
                WHEN ph.phanHoiPhu IS NULL THEN 'pending'
                ELSE 'replied'
            END as status
        FROM phanhoi ph
        WHERE ph.maSV = ?
        ORDER BY ph.ngayGui DESC
    `;

    try {
        const [rows] = await db.execute(sql, [maSV]);
        res.json(rows);
    } catch (err) {
        console.error('LỖI KHI TẢI PHẢN HỒI SINH VIÊN:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải dữ liệu' });
    }
});

module.exports = router;