// routes/phancong.js - API cho quản lý phân công giảng dạy (CẢI TIẾN ĐẦY ĐỦ)
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ storage: multer.memoryStorage() });

// Thêm cột hocKy nếu chưa có
async function ensureHocKyColumn() {
    try {
        await db.execute(`ALTER TABLE lop_mh_gv ADD COLUMN IF NOT EXISTS hocKy VARCHAR(10) DEFAULT NULL`);
    } catch (err) {
        console.error('Lỗi thêm cột hocKy:', err.message);
    }
}
ensureHocKyColumn();

// ===== GET ENDPOINTS =====

// GET /api/phancong: Lấy tất cả phân công (với search và join để lấy tên)
router.get('/', async (req, res) => {
    const { maGV, _q: query } = req.query; // Thêm maGV param để filter theo giảng viên
    const SELECT_PHANCONG_QUERY = `
        SELECT lmg.id, lmg.maLop, lh.tenLop, lh.maKhoa as maKhoaLop,
               lmg.maMH, mh.tenMH, mh.maKhoa as maKhoaMH,
               lmg.maGV, gv.hoTen, gv.maKhoa as maKhoaGV, 
               lmg.hocKy,
               lg.id as lich_id, lg.thu_tuan, lg.tiet_bat_dau, lg.so_tiet, lg.phong_hoc, lg.ghi_chu
        FROM lop_mh_gv lmg
        JOIN lophoc lh ON lmg.maLop = lh.maLop
        JOIN monhoc mh ON lmg.maMH = mh.maMH
        JOIN giangvien gv ON lmg.maGV = gv.maGV
        LEFT JOIN lich_giang_day lg ON lmg.id = lg.id_phan_cong
    `;
    
    let sql = SELECT_PHANCONG_QUERY;
    let params = [];

    // Filter theo maGV nếu có
    if (maGV) {
        sql += ' WHERE lmg.maGV = ?';
        params.push(maGV);
    }

    if (query) {
        const whereClause = maGV ? ' AND ' : ' WHERE ';
        sql += `${whereClause} (lmg.maLop LIKE ? OR lh.tenLop LIKE ? OR lmg.maMH LIKE ? OR mh.tenMH LIKE ? OR lmg.maGV LIKE ? OR gv.hoTen LIKE ? OR lmg.hocKy LIKE ?)`;
        params.push(
            `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, 
            `%${query}%`, `%${query}%`, `%${query}%`
        );
    }
    sql += ' ORDER BY lmg.id, lg.thu_tuan, lg.tiet_bat_dau';

    try {
        const [rows] = await db.execute(sql, params);
        
        // Group rows by phân công id để tránh duplicate do JOIN 1-N với lịch
        const grouped = rows.reduce((acc, row) => {
            const key = row.id;
            if (!acc[key]) {
                acc[key] = { 
                    id: row.id,
                    maLop: row.maLop,
                    tenLop: row.tenLop,
                    maKhoaLop: row.maKhoaLop,
                    maMH: row.maMH,
                    tenMH: row.tenMH,
                    maKhoaMH: row.maKhoaMH,
                    maGV: row.maGV,
                    hoTen: row.hoTen,
                    maKhoaGV: row.maKhoaGV,
                    hocKy: row.hocKy,
                    lich: [] 
                };
            }
            if (row.lich_id) {
                acc[key].lich.push({
                    lich_id: row.lich_id,
                    thu_tuan: row.thu_tuan,
                    tiet_bat_dau: row.tiet_bat_dau,
                    so_tiet: row.so_tiet,
                    phong_hoc: row.phong_hoc,
                    ghi_chu: row.ghi_chu
                });
            }
            return acc;
        }, {});
        
        res.json(Object.values(grouped));
    } catch (err) {
        console.error('Lỗi GET phân công:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải dữ liệu' });
    }
});

// Các route khác giữ nguyên (không thay đổi)
router.get('/lops', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT maLop, tenLop, maKhoa FROM lophoc ORDER BY maLop');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Lỗi tải danh sách lớp' });
    }
});
// GET /api/phancong/monhocs: Lấy danh sách môn học cho dropdown (kèm khoa)
router.get('/monhocs', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT maMH, tenMH, soTinChi, maKhoa FROM monhoc ORDER BY maMH');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Lỗi khi tải môn học' });
    }
});

// GET /api/phancong/giangviens: Lấy danh sách giảng viên cho dropdown (kèm khoa)
router.get('/giangviens', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT maGV, hoTen, maKhoa FROM giangvien ORDER BY maGV');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Lỗi khi tải giảng viên' });
    }
});

// GET /api/phancong/export: Export ra Excel
router.get('/export', async (req, res) => {
    try {
        const SELECT_EXPORT_QUERY = `
            SELECT lmg.id, lmg.maLop, lh.tenLop, lmg.maMH, mh.tenMH, lmg.maGV, gv.hoTen, lmg.hocKy
            FROM lop_mh_gv lmg
            JOIN lophoc lh ON lmg.maLop = lh.maLop
            JOIN monhoc mh ON lmg.maMH = mh.maMH
            JOIN giangvien gv ON lmg.maGV = gv.maGV
            ORDER BY lmg.id
        `;

        const [rows] = await db.execute(SELECT_EXPORT_QUERY);
        
        const wsData = rows.map(row => ({
            'ID': row.id,
            'Mã Lớp': row.maLop,
            'Tên Lớp': row.tenLop,
            'Mã MH': row.maMH,
            'Tên Môn Học': row.tenMH,
            'Mã GV': row.maGV,
            'Tên GV': row.hoTen,
            'Học Kỳ': row.hocKy || ''
        }));

        const ws = XLSX.utils.json_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Phân công');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=phancong_giang_day.xlsx');
        res.send(buffer);

    } catch (err) {
        console.error('Lỗi export:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi export' });
    }
});

router.get('/export-selected', async (req, res) => {
    const { selected } = req.query;
    if (!selected) {
        return res.status(400).json({ message: 'Thiếu danh sách ID' });
    }

    const ids = selected.split(',');
    const SELECT_EXPORT_QUERY = `
        SELECT lmg.id, lmg.maLop, lh.tenLop, lmg.maMH, mh.tenMH, 
               lmg.maGV, gv.hoTen, lmg.hocKy
        FROM lop_mh_gv lmg
        JOIN lophoc lh ON lmg.maLop = lh.maLop
        JOIN monhoc mh ON lmg.maMH = mh.maMH
        JOIN giangvien gv ON lmg.maGV = gv.maGV
        WHERE lmg.id IN (${ids.map(() => '?').join(',')})
        ORDER BY lmg.id
    `;

    try {
        const [rows] = await db.execute(SELECT_EXPORT_QUERY, ids);
        
        const wsData = rows.map(row => ({
            'ID': row.id,
            'Mã Lớp': row.maLop,
            'Tên Lớp': row.tenLop,
            'Mã MH': row.maMH,
            'Tên Môn Học': row.tenMH,
            'Mã GV': row.maGV,
            'Tên GV': row.hoTen,
            'Học Kỳ': row.hocKy || ''
        }));

        const ws = XLSX.utils.json_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Phân công đã chọn');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=phancong_${new Date().toISOString().split('T')[0]}.xlsx`);
        res.send(buffer);

    } catch (err) {
        console.error('Lỗi export selected:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi export' });
    }
});

// ===== POST ENDPOINTS =====

// POST /api/phancong: Thêm phân công
router.post('/', async (req, res) => {
    const { maLop, maMH, maGV, hocKy } = req.body;
    if (!maLop || !maMH || !maGV || !hocKy) {
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc!' });
    }
    
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // Kiểm tra FK constraints
        const [lopCheck] = await conn.execute('SELECT maLop, maKhoa FROM lophoc WHERE maLop = ?', [maLop]);
        if (lopCheck.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Lớp học không tồn tại!' });
        }

        const [mhCheck] = await conn.execute('SELECT maMH, maKhoa FROM monhoc WHERE maMH = ?', [maMH]);
        if (mhCheck.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Môn học không tồn tại!' });
        }

        const [gvCheck] = await conn.execute('SELECT maGV, maKhoa FROM giangvien WHERE maGV = ?', [maGV]);
        if (gvCheck.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Giảng viên không tồn tại!' });
        }

        // Kiểm tra khoa phải giống nhau
        const lopKhoa = lopCheck[0].maKhoa;
        const mhKhoa = mhCheck[0].maKhoa;
        const gvKhoa = gvCheck[0].maKhoa;

        if (lopKhoa !== mhKhoa || lopKhoa !== gvKhoa) {
            await conn.rollback();
            return res.status(400).json({ 
                message: `Lớp, môn học và giảng viên phải cùng khoa! (Lớp: ${lopKhoa}, Môn: ${mhKhoa}, GV: ${gvKhoa})` 
            });
        }

        // Kiểm tra duplicate (maLop, maMH, maGV, hocKy)
        const [duplicate] = await conn.execute(
            'SELECT id FROM lop_mh_gv WHERE maLop = ? AND maMH = ? AND maGV = ? AND hocKy = ?',
            [maLop, maMH, maGV, hocKy]
        );
        if (duplicate.length > 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Phân công này đã tồn tại!' });
        }

        const sql = `INSERT INTO lop_mh_gv (maLop, maMH, maGV, hocKy) VALUES (?, ?, ?, ?)`;
        await conn.execute(sql, [maLop, maMH, maGV, hocKy]);

        await conn.commit();
        res.status(201).json({ message: 'Thêm phân công thành công' });

    } catch (err) {
        await conn.rollback();
        console.error('Lỗi thêm phân công:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ: ' + err.message });
    } finally {
        conn.release();
    }
});

// POST /api/phancong/import: Import từ Excel
router.post('/import', upload.single('excelFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Không có file upload!' });
    }
    
    try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);
        
        if (data.length === 0) {
            return res.status(400).json({ message: 'File không có dữ liệu!' });
        }
        
        const conn = await db.getConnection();
        let successCount = 0;
        let errorRows = [];
        
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const maLop = row['Mã Lớp'] || row['maLop'];
            const maMH = row['Mã MH'] || row['maMH'];
            const maGV = row['Mã GV'] || row['maGV'];
            const hocKy = row['Học Kỳ'] || row['hocKy'];
            
            if (!maLop || !maMH || !maGV || !hocKy) {
                errorRows.push({ row: i + 2, error: 'Thiếu thông tin bắt buộc' });
                continue;
            }
            
            // Kiểm tra tồn tại và khoa
            const [lopCheck] = await conn.execute('SELECT maLop, maKhoa FROM lophoc WHERE maLop = ?', [maLop]);
            if (lopCheck.length === 0) {
                errorRows.push({ row: i + 2, error: `Lớp '${maLop}' không tồn tại` });
                continue;
            }

            const [mhCheck] = await conn.execute('SELECT maMH, maKhoa FROM monhoc WHERE maMH = ?', [maMH]);
            if (mhCheck.length === 0) {
                errorRows.push({ row: i + 2, error: `Môn '${maMH}' không tồn tại` });
                continue;
            }

            const [gvCheck] = await conn.execute('SELECT maGV, maKhoa FROM giangvien WHERE maGV = ?', [maGV]);
            if (gvCheck.length === 0) {
                errorRows.push({ row: i + 2, error: `GV '${maGV}' không tồn tại` });
                continue;
            }

            // Kiểm tra khoa
            if (lopCheck[0].maKhoa !== mhCheck[0].maKhoa || lopCheck[0].maKhoa !== gvCheck[0].maKhoa) {
                errorRows.push({ row: i + 2, error: 'Lớp, môn, GV không cùng khoa' });
                continue;
            }

            // Kiểm tra duplicate
            const [duplicate] = await conn.execute(
                'SELECT id FROM lop_mh_gv WHERE maLop = ? AND maMH = ? AND maGV = ? AND hocKy = ?',
                [maLop, maMH, maGV, hocKy]
            );
            if (duplicate.length > 0) {
                errorRows.push({ row: i + 2, error: 'Phân công này đã tồn tại' });
                continue;
            }
            
            try {
                await conn.execute(
                    `INSERT INTO lop_mh_gv (maLop, maMH, maGV, hocKy) VALUES (?, ?, ?, ?)`,
                    [maLop, maMH, maGV, hocKy]
                );
                successCount++;
            } catch (pcErr) {
                errorRows.push({ row: i + 2, error: `Lỗi insert: ${pcErr.message}` });
            }
        }
        
        await conn.release();
        
        let message = `Import thành công ${successCount}/${data.length} dòng.`;
        if (errorRows.length > 0) {
            message += ` Lỗi ở ${errorRows.length} dòng`;
        }
        res.json({ message, errors: errorRows });
        
    } catch (err) {
        console.error('Lỗi import:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi import' });
    }
});

// POST /api/phancong/:id/lich: Thêm lịch cho phân công
router.post('/:id/lich', async (req, res) => {
    const { id } = req.params;
    const { thu_tuan, tiet_bat_dau, so_tiet, phong_hoc, ghi_chu } = req.body;
    
    if (!thu_tuan || !tiet_bat_dau || !so_tiet) {
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc: thu_tuan, tiet_bat_dau, so_tiet!' });
    }

    // Validate giá trị
    if (thu_tuan < 2 || thu_tuan > 8) {
        return res.status(400).json({ message: 'Thứ trong tuần phải từ 2-8 (2=Thứ 2, ..., 8=CN)' });
    }
    if (tiet_bat_dau < 1 || tiet_bat_dau > 12) {
        return res.status(400).json({ message: 'Tiết bắt đầu phải từ 1-12' });
    }
    if (so_tiet < 1 || so_tiet > 5) {
        return res.status(400).json({ message: 'Số tiết phải từ 1-5' });
    }
    
    const sql = `INSERT INTO lich_giang_day (id_phan_cong, thu_tuan, tiet_bat_dau, so_tiet, phong_hoc, ghi_chu) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
    
    try {
        await db.execute(sql, [id, thu_tuan, tiet_bat_dau, so_tiet, phong_hoc || null, ghi_chu || null]);
        res.status(201).json({ message: 'Thêm lịch thành công' });
    } catch (err) {
        if (err.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({ message: 'Phân công không tồn tại!' });
        }
        console.error('Lỗi thêm lịch:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ: ' + err.message });
    }
});

// ===== PUT ENDPOINTS =====

// PUT /api/phancong/:id: Cập nhật phân công
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { maLop, maMH, maGV, hocKy } = req.body;
    
    if (!maLop || !maMH || !maGV || !hocKy) {
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc!' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // Kiểm tra FK constraints và khoa
        const [lopCheck] = await conn.execute('SELECT maLop, maKhoa FROM lophoc WHERE maLop = ?', [maLop]);
        if (lopCheck.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Lớp học không tồn tại!' });
        }

        const [mhCheck] = await conn.execute('SELECT maMH, maKhoa FROM monhoc WHERE maMH = ?', [maMH]);
        if (mhCheck.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Môn học không tồn tại!' });
        }

        const [gvCheck] = await conn.execute('SELECT maGV, maKhoa FROM giangvien WHERE maGV = ?', [maGV]);
        if (gvCheck.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Giảng viên không tồn tại!' });
        }

        // Kiểm tra khoa
        const lopKhoa = lopCheck[0].maKhoa;
        const mhKhoa = mhCheck[0].maKhoa;
        const gvKhoa = gvCheck[0].maKhoa;

        if (lopKhoa !== mhKhoa || lopKhoa !== gvKhoa) {
            await conn.rollback();
            return res.status(400).json({ 
                message: `Lớp, môn học và giảng viên phải cùng khoa! (Lớp: ${lopKhoa}, Môn: ${mhKhoa}, GV: ${gvKhoa})` 
            });
        }

        const sql = `UPDATE lop_mh_gv SET maLop = ?, maMH = ?, maGV = ?, hocKy = ? WHERE id = ?`;
        const [result] = await conn.execute(sql, [maLop, maMH, maGV, hocKy, id]);

        if (result.affectedRows === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Phân công không tồn tại' });
        }

        await conn.commit();
        res.json({ message: 'Cập nhật phân công thành công' });

    } catch (err) {
        await conn.rollback();
        console.error('Lỗi cập nhật phân công:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ: ' + err.message });
    } finally {
        conn.release();
    }
});

// PUT /api/phancong/:id/lich/:lich_id
router.put('/:id/lich/:lich_id', async (req, res) => {
    const { id, lich_id } = req.params;
    const { thu_tuan, tiet_bat_dau, so_tiet, phong_hoc, ghi_chu } = req.body;

    // Validate input
    if (!thu_tuan || !tiet_bat_dau || !so_tiet) {
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc: thu_tuan, tiet_bat_dau, so_tiet!' });
    }

    // Validate giá trị
    if (thu_tuan < 2 || thu_tuan > 8) {
        return res.status(400).json({ message: 'Thứ trong tuần phải từ 2-8' });
    }
    if (tiet_bat_dau < 1 || tiet_bat_dau > 12) {
        return res.status(400).json({ message: 'Tiết bắt đầu phải từ 1-12' });
    }
    if (so_tiet < 1 || so_tiet > 5) {
        return res.status(400).json({ message: 'Số tiết phải từ 1-5' });
    }

    const fields = [];
    const params = [];

    if (thu_tuan !== undefined) { fields.push('thu_tuan = ?'); params.push(thu_tuan); }
    if (tiet_bat_dau !== undefined) { fields.push('tiet_bat_dau = ?'); params.push(tiet_bat_dau); }
    if (so_tiet !== undefined) { fields.push('so_tiet = ?'); params.push(so_tiet); }
    if (phong_hoc !== undefined) { fields.push('phong_hoc = ?'); params.push(phong_hoc || null); }
    if (ghi_chu !== undefined) { fields.push('ghi_chu = ?'); params.push(ghi_chu || null); }

    if (fields.length === 0) {
        return res.status(400).json({ message: 'Không có dữ liệu cập nhật!' });
    }

    // ⚠️ FIX: Sử dụng `id` (khóa chính) trong WHERE, không phải `lich_id`
    const sql = `UPDATE lich_giang_day SET ${fields.join(', ')} WHERE id = ? AND id_phan_cong = ?`;
    params.push(lich_id, id);

    try {
        const [result] = await db.execute(sql, params);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy lịch để cập nhật!' });
        }
        res.json({ message: 'Cập nhật thành công' });
    } catch (err) {
        console.error('Lỗi cập nhật lịch:', err.message);
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// DELETE /api/phancong/:id: Xóa phân công
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const conn = await db.getConnection();
    
    try {
        await conn.beginTransaction();

        // Xóa lịch trước (vì có FK)
        await conn.execute('DELETE FROM lich_giang_day WHERE id_phan_cong = ?', [id]);

        // Xóa phân công
        const [result] = await conn.execute('DELETE FROM lop_mh_gv WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Phân công không tồn tại' });
        }

        await conn.commit();
        res.json({ message: 'Xóa phân công thành công' });

    } catch (err) {
        await conn.rollback();
        console.error('Lỗi xóa phân công:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ: ' + err.message });
    } finally {
        conn.release();
    }
});

// DELETE /api/phancong/:id/lich/:lich_id: Xóa lịch
router.delete('/:id/lich/:lich_id', async (req, res) => {
    const { id, lich_id } = req.params;
    const sql = 'DELETE FROM lich_giang_day WHERE id = ? AND id_phan_cong = ?';
    
    try {
        const [result] = await db.execute(sql, [lich_id, id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Lịch không tồn tại hoặc không thuộc phân công này' });
        }
        res.json({ message: 'Xóa lịch thành công' });
    } catch (err) {
        console.error('Lỗi xóa lịch:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ: ' + err.message });
    }
});

module.exports = router;