const express = require('express');
const router = express.Router();
const db = require('../config/db');
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ storage: multer.memoryStorage() });

// Query lấy dữ liệu Môn học (JOIN với Khoa)
const SELECT_MONHOC_QUERY = `
    SELECT 
        mh.maMH, mh.tenMH, mh.soTinChi, 
        mh.maKhoa, k.tenKhoa
    FROM monhoc mh
    LEFT JOIN khoa k ON mh.maKhoa = k.maKhoa
`;

// Query cho thống kê môn học
const STATS_MONHOC_QUERY = `
    SELECT k.tenKhoa, COUNT(mh.maMH) as soLuong 
    FROM khoa k 
    LEFT JOIN monhoc mh ON k.maKhoa = mh.maKhoa 
    GROUP BY k.maKhoa, k.tenKhoa
`;

// GET /api/monhoc: Lấy tất cả hoặc tìm kiếm với pagination và filter (CẬP NHẬT HỖ TRỢ FILTER KHOA)
router.get('/', async (req, res) => {
    const { _q: query, page = 1, limit = 100, maKhoa, soTinChi } = req.query;
    let sql = SELECT_MONHOC_QUERY;
    let countSql = `SELECT COUNT(DISTINCT mh.maMH) as total FROM monhoc mh LEFT JOIN khoa k ON mh.maKhoa = k.maKhoa`;
    let params = [];
    let countParams = [];

    // Xây dựng WHERE clause cho filter và search
    let whereClause = '';
    let conditions = [];

    if (query) {
        conditions.push('(mh.maMH LIKE ? OR mh.tenMH LIKE ? OR k.tenKhoa LIKE ?)');
        params.push(`%${query}%`, `%${query}%`, `%${query}%`);
        countParams.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }

    if (maKhoa) {
        conditions.push('mh.maKhoa = ?');
        params.push(maKhoa);
        countParams.push(maKhoa);
    }

    if (soTinChi) {
        conditions.push('mh.soTinChi = ?');
        params.push(parseInt(soTinChi));
        countParams.push(parseInt(soTinChi));
    }

    if (conditions.length > 0) {
        whereClause = ' WHERE ' + conditions.join(' AND ');
        sql += whereClause;
        countSql += whereClause;
    }

    sql += ' ORDER BY mh.maMH LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    try {
        // Lấy total count trước
        const [countRows] = await db.execute(countSql, countParams);
        const total = countRows[0].total;

        // Lấy data
        const [rows] = await db.execute(sql, params);
        res.json({
            data: rows,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        console.error('LỖI KHI TẢI DANH SÁCH MÔN HỌC:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải dữ liệu' });
    }
});

// GET /api/monhoc/khoa/:maKhoa: Lấy danh sách môn của một khoa (cho dropdown)
router.get('/khoa/:maKhoa', async (req, res) => {
    const { maKhoa } = req.params;
    try {
        const [rows] = await db.execute(
            'SELECT maMH, tenMH, soTinChi FROM monhoc WHERE maKhoa = ? ORDER BY maMH',
            [maKhoa]
        );
        res.json(rows);
    } catch (err) {
        console.error('Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// GET /api/monhoc/check-unique: Kiểm tra unique maMH
router.get('/check-unique', async (req, res) => {
    const { field, value } = req.query;
    if (!field || !value) return res.status(400).json({ available: false, message: 'Thiếu field/value' });
    try {
        let sql = 'SELECT maMH FROM monhoc WHERE maMH = ?';
        const [rows] = await db.execute(sql, [value]);
        res.json({ available: rows.length === 0 });
    } catch (err) {
        res.status(500).json({ available: false, message: 'Lỗi kiểm tra' });
    }
});

// GET /api/monhoc/export: Export ra Excel
router.get('/export', async (req, res) => {
    try {
        // Query data giống như GET chính, nhưng full
        const [rows] = await db.execute(SELECT_MONHOC_QUERY);
        
        // Chuyển thành worksheet
        const wsData = rows.map(row => ({
            maMH: row.maMH,
            tenMH: row.tenMH,
            soTinChi: row.soTinChi,
            maKhoa: row.maKhoa,
            tenKhoa: row.tenKhoa || ''
        }));
        
        const ws = XLSX.utils.json_to_sheet(wsData);
        
        // Query thống kê
        const [statsRows] = await db.execute(STATS_MONHOC_QUERY);
        const wsDataStats = statsRows.map(row => ({
            TenKhoa: row.tenKhoa,
            SoLuong: row.soLuong
        }));
        const wsStats = XLSX.utils.json_to_sheet(wsDataStats);
        
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'DanhSachMonHoc');
        XLSX.utils.book_append_sheet(wb, wsStats, 'ThongKeMonHocTheoKhoa');
        
        // Generate buffer
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=danh_sach_mon_hoc.xlsx');
        res.send(buffer);
        
    } catch (err) {
        console.error('LỖI KHI EXPORT MÔN HỌC:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi export dữ liệu' });
    }
});

// GET /api/monhoc/export-selected: Export môn học đã chọn
router.get('/export-selected', async (req, res) => {
    const { selected } = req.query;
    if (!selected) {
        return res.status(400).json({ message: 'Thiếu danh sách maMH đã chọn' });
    }

    const maMHs = selected.split(',');

    let sql = `
        SELECT 
            mh.maMH, mh.tenMH, mh.soTinChi, 
            mh.maKhoa, k.tenKhoa
        FROM monhoc mh
        LEFT JOIN khoa k ON mh.maKhoa = k.maKhoa
        WHERE mh.maMH IN (${maMHs.map(() => '?').join(',')})
    `;

    try {
        const [rows] = await db.execute(sql, maMHs);
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Môn học đã chọn');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=mon_hoc_da_chon_${new Date().toISOString().split('T')[0]}.xlsx`);
        res.send(buffer);
    } catch (err) {
        console.error('LỖI KHI EXPORT MÔN HỌC ĐÃ CHỌN:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi export dữ liệu' });
    }
});

// POST /api/monhoc: Thêm Môn học
router.post('/', async (req, res) => {
    const { maMH, tenMH, soTinChi, maKhoa } = req.body;
    
    if (!maMH || !tenMH || !soTinChi || !maKhoa) { 
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc: Mã MH, Tên MH, Số tín chỉ hoặc Mã Khoa.' });
    }
    
    // Đảm bảo soTC là số
    if (isNaN(parseInt(soTinChi))) {
        return res.status(400).json({ message: 'Số tín chỉ phải là một số hợp lệ.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        
        // Kiểm tra maKhoa tồn tại
        const [existingKhoa] = await conn.execute('SELECT maKhoa FROM khoa WHERE maKhoa = ?', [maKhoa]);
        if (existingKhoa.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Mã Khoa không hợp lệ.' });
        }
        
        // Insert môn học
        await conn.execute(
            `INSERT INTO monhoc (maMH, tenMH, soTinChi, maKhoa) VALUES (?, ?, ?, ?)`,
            [maMH, tenMH, parseInt(soTinChi), maKhoa]
        );
        
        await conn.commit();
        res.status(201).json({ message: 'Thêm môn học thành công' });
        
    } catch (err) {
        await conn.rollback();
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Mã Môn học đã tồn tại!' });
        if (err.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({ message: 'Mã Khoa không hợp lệ.' });
        }
        console.error('LỖI KHI THÊM MÔN HỌC:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi thêm dữ liệu' });
    } finally {
        conn.release();
    }
});

// POST /api/monhoc/import: Import từ Excel/CSV
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
        
        for (let row of data) {
            const { maMH, tenMH, soTinChi, maKhoa } = row;
            
            // Validation cơ bản
            if (!maMH || !tenMH || !soTinChi || !maKhoa) {
                errorRows.push({ row: row.__rowNum__ + 1, error: 'Thiếu thông tin bắt buộc (maMH, tenMH, soTinChi, maKhoa)' });
                continue;
            }
            
            // Kiểm tra duplicate maMH
            const [existingMH] = await conn.execute('SELECT maMH FROM monhoc WHERE maMH = ?', [maMH]);
            if (existingMH.length > 0) {
                errorRows.push({ row: row.__rowNum__ + 1, error: `Mã MH '${maMH}' đã tồn tại` });
                continue;
            }
            
            // Kiểm tra maKhoa tồn tại
            const [existingKhoa] = await conn.execute('SELECT maKhoa FROM khoa WHERE maKhoa = ?', [maKhoa]);
            if (existingKhoa.length === 0) {
                errorRows.push({ row: row.__rowNum__ + 1, error: `Mã Khoa '${maKhoa}' không tồn tại` });
                continue;
            }
            
            // Insert môn học
            try {
                await conn.execute(
                    `INSERT INTO monhoc (maMH, tenMH, soTinChi, maKhoa) VALUES (?, ?, ?, ?)`,
                    [maMH, tenMH, parseInt(soTinChi), maKhoa]
                );
                successCount++;
            } catch (mhErr) {
                errorRows.push({ row: row.__rowNum__ + 1, error: `Lỗi insert: ${mhErr.message}` });
            }
        }
        
        await conn.release();
        
        let message = `Import thành công ${successCount}/${data.length} dòng.`;
        if (errorRows.length > 0) {
            message += ` Lỗi ở các dòng: ${JSON.stringify(errorRows.slice(0, 5))}... (tổng ${errorRows.length} lỗi)`;
        }
        res.json({ message });
        
    } catch (err) {
        console.error('LỖI KHI IMPORT MÔN HỌC:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi import dữ liệu' });
    }
});

// PUT /api/monhoc/:maMH: Cập nhật Môn học
router.put('/:maMH', async (req, res) => {
    const { maMH } = req.params;
    const { tenMH, soTinChi, maKhoa } = req.body;
    
    if (!tenMH || !soTinChi || !maKhoa) {
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc để cập nhật.' });
    }
    
    if (isNaN(parseInt(soTinChi))) {
        return res.status(400).json({ message: 'Số tín chỉ phải là một số hợp lệ.' });
    }

    const sql = `
        UPDATE monhoc SET tenMH = ?, soTinChi = ?, maKhoa = ?
        WHERE maMH = ?
    `;
    const params = [tenMH, parseInt(soTinChi), maKhoa, maMH];

    try {
        const [result] = await db.execute(sql, params);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy môn học với mã MH này' });
        }
        res.json({ message: 'Cập nhật môn học thành công' });
    } catch (err) {
        if (err.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({ message: 'Mã Khoa không hợp lệ.' });
        }
        console.error('LỖI KHI CẬP NHẬT MÔN HỌC:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi cập nhật dữ liệu' });
    }
});

// DELETE /api/monhoc/:maMH: Xóa Môn học
router.delete('/:maMH', async (req, res) => {
    const { maMH } = req.params;
    const sql = 'DELETE FROM monhoc WHERE maMH = ?';
    
    try {
        const [result] = await db.execute(sql, [maMH]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy môn học với mã MH này' });
        }
        res.json({ message: 'Xóa môn học thành công' });
    } catch (err) {
        if (err.code === 'ER_ROW_IS_REFERENCED_2') { 
            return res.status(400).json({ message: 'Không thể xóa môn học này vì đang liên kết với Điểm, Lịch thi hoặc Lớp học/Giảng viên.' });
        }
        console.error('LỖI KHI XÓA MÔN HỌC:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi xóa dữ liệu' });
    }
});

// GET /api/monhoc/stats: Lấy thống kê tổng quan
router.get('/stats', async (req, res) => {
    try {
        // 1. Tổng số môn học
        const [totalRows] = await db.execute('SELECT COUNT(*) as total FROM monhoc');
        const totalMonHoc = totalRows[0].total;

        // 2. Tổng số tín chỉ
        const [tinChiRows] = await db.execute('SELECT SUM(soTinChi) as total FROM monhoc');
        const totalTinChi = tinChiRows[0].total || 0;

        // 3. Môn học được đăng ký nhiều nhất (dựa vào bảng điểm)
        const [popularRows] = await db.execute(`
            SELECT mh.maMH, mh.tenMH, COUNT(DISTINCT d.maSV) as soSV
            FROM monhoc mh
            LEFT JOIN diem d ON mh.maMH = d.maMH
            GROUP BY mh.maMH, mh.tenMH
            ORDER BY soSV DESC
            LIMIT 1
        `);
        const mostPopular = popularRows[0] || null;

        // 4. Số khoa có môn học
        const [khoaRows] = await db.execute('SELECT COUNT(DISTINCT maKhoa) as total FROM monhoc WHERE maKhoa IS NOT NULL');
        const totalKhoa = khoaRows[0].total;

        // 5. Phân bố môn học theo khoa
        const [byKhoaRows] = await db.execute(`
            SELECT k.maKhoa, k.tenKhoa, COUNT(mh.maMH) as soLuong
            FROM khoa k
            LEFT JOIN monhoc mh ON k.maKhoa = mh.maKhoa
            GROUP BY k.maKhoa, k.tenKhoa
            ORDER BY soLuong DESC
        `);

        // 6. Phân bố theo số tín chỉ
        const [byTinChiRows] = await db.execute(`
            SELECT soTinChi, COUNT(*) as soLuong
            FROM monhoc
            GROUP BY soTinChi
            ORDER BY soTinChi
        `);

        res.json({
            totalMonHoc,
            totalTinChi,
            mostPopular,
            totalKhoa,
            byKhoa: byKhoaRows,
            byTinChi: byTinChiRows
        });
    } catch (err) {
        console.error('LỖI KHI TẢI THỐNG KÊ:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải thống kê' });
    }
});

// GET /api/monhoc/:maMH/details: Xem chi tiết môn học (lớp, giảng viên, sinh viên)
router.get('/:maMH/details', async (req, res) => {
    const { maMH } = req.params;
    try {
        // Thông tin cơ bản
        const [basicInfo] = await db.execute(`
            SELECT mh.*, k.tenKhoa
            FROM monhoc mh
            LEFT JOIN khoa k ON mh.maKhoa = k.maKhoa
            WHERE mh.maMH = ?
        `, [maMH]);

        if (basicInfo.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy môn học' });
        }

        // Danh sách lớp học môn này
        const [classes] = await db.execute(`
            SELECT lmg.id, lh.maLop, lh.tenLop, gv.maGV, gv.hoTen as tenGV, lmg.hocKy
            FROM lop_mh_gv lmg
            JOIN lophoc lh ON lmg.maLop = lh.maLop
            LEFT JOIN giangvien gv ON lmg.maGV = gv.maGV
            WHERE lmg.maMH = ?
        `, [maMH]);

        // Số sinh viên đã học/đang học
        const [studentCount] = await db.execute(`
            SELECT COUNT(DISTINCT maSV) as total
            FROM diem
            WHERE maMH = ?
        `, [maMH]);

        // Điểm trung bình môn học
        const [avgScore] = await db.execute(`
            SELECT AVG(diemTK) as diemTB
            FROM diem
            WHERE maMH = ? AND diemTK IS NOT NULL
        `, [maMH]);

        // Lịch thi
        const [examSchedule] = await db.execute(`
            SELECT *
            FROM lichthi
            WHERE maMH = ?
        `, [maMH]);

        res.json({
            info: basicInfo[0],
            classes,
            studentCount: studentCount[0].total,
            avgScore: avgScore[0].diemTB ? parseFloat(avgScore[0].diemTB).toFixed(2) : null,
            examSchedule
        });
    } catch (err) {
        console.error('LỖI KHI TẢI CHI TIẾT MÔN HỌC:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải chi tiết' });
    }
});

module.exports = router;