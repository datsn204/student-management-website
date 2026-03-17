// routes/khoa.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ storage: multer.memoryStorage() });

// Query lấy tất cả Khoa với thống kê
const SELECT_KHOA_QUERY = `
    SELECT 
        k.maKhoa, 
        k.tenKhoa,
        COUNT(DISTINCT sv.maSV) as soSinhVien,
        COUNT(DISTINCT gv.maGV) as soGiangVien,
        COUNT(DISTINCT mh.maMH) as soMonHoc,
        COUNT(DISTINCT lh.maLop) as soLopHoc
    FROM khoa k
    LEFT JOIN SinhVien sv ON k.maKhoa = sv.maKhoa
    LEFT JOIN GiangVien gv ON k.maKhoa = gv.maKhoa
    LEFT JOIN MonHoc mh ON k.maKhoa = mh.maKhoa
    LEFT JOIN LopHoc lh ON k.maKhoa = lh.maKhoa
`;

// Query thống kê tổng quan
const STATS_KHOA_QUERY = `
    SELECT 
        (SELECT COUNT(*) FROM Khoa) as totalKhoa,
        (SELECT COUNT(*) FROM SinhVien) as totalStudents,
        (SELECT COUNT(*) FROM GiangVien) as totalLecturers,
        (SELECT COUNT(*) FROM MonHoc) as totalCourses,
        (SELECT COUNT(*) FROM LopHoc) as totalClasses
`;

// GET /api/khoas/stats: Lấy thống kê tổng quan
router.get('/stats', async (req, res) => {
    try {
        const [statsRows] = await db.execute(STATS_KHOA_QUERY);
        const stats = statsRows[0] || {
            totalKhoa: 0,
            totalStudents: 0,
            totalLecturers: 0,
            totalCourses: 0,
            totalClasses: 0
        };
        res.json(stats);
    } catch (err) {
        console.error('LỖI KHI TẢI THỐNG KÊ:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải thống kê' });
    }
});

// GET /api/khoas: Lấy tất cả hoặc tìm kiếm
router.get('/', async (req, res) => {
    const query = req.query._q;
    let sql = SELECT_KHOA_QUERY;
    let params = [];
    let whereClause = '';
    
    if (query) {
        whereClause = ' WHERE k.maKhoa LIKE ? OR k.tenKhoa LIKE ?';
        params = [`%${query}%`, `%${query}%`];
    }
    
    sql += whereClause + ' GROUP BY k.maKhoa, k.tenKhoa ORDER BY k.maKhoa';
    
    try {
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    } catch (err) {
        console.error('LỖI KHI TẢI DANH SÁCH KHOA:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải dữ liệu' });
    }
});

// GET /api/khoas/:maKhoa/details: Xem chi tiết khoa
router.get('/:maKhoa/details', async (req, res) => {
    const { maKhoa } = req.params;
    try {
        // Thông tin cơ bản
        const [basicInfo] = await db.execute(`
            SELECT maKhoa, tenKhoa
            FROM Khoa
            WHERE maKhoa = ?
        `, [maKhoa]);

        if (basicInfo.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy khoa' });
        }

        const info = basicInfo[0];

        // Thống kê
        const [statsData] = await db.execute(`
            SELECT 
                COUNT(DISTINCT sv.maSV) as soSinhVien,
                COUNT(DISTINCT gv.maGV) as soGiangVien,
                COUNT(DISTINCT mh.maMH) as soMonHoc,
                COUNT(DISTINCT lh.maLop) as soLopHoc
            FROM Khoa k
            LEFT JOIN SinhVien sv ON k.maKhoa = sv.maKhoa
            LEFT JOIN GiangVien gv ON k.maKhoa = gv.maKhoa
            LEFT JOIN MonHoc mh ON k.maKhoa = mh.maKhoa
            LEFT JOIN LopHoc lh ON k.maKhoa = lh.maKhoa
            WHERE k.maKhoa = ?
        `, [maKhoa]);

        const stats = statsData[0] || { 
            soSinhVien: 0, 
            soGiangVien: 0, 
            soMonHoc: 0 ,
            soLopHoc: 0 
        };

        // Danh sách giảng viên
        const [lecturers] = await db.execute(`
            SELECT maGV, hoTen, hocVi, email, sdt
            FROM GiangVien
            WHERE maKhoa = ?
            ORDER BY maGV
        `, [maKhoa]);

        // Danh sách môn học
        const [courses] = await db.execute(`
            SELECT maMH, tenMH, soTinChi
            FROM MonHoc
            WHERE maKhoa = ?
            ORDER BY maMH
        `, [maKhoa]);

        res.json({
            info,
            stats,
            lecturers: lecturers || [],
            courses: courses || []
        });
    } catch (err) {
        console.error('LỖI CHI TIẾT:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi: ' + err.message });
    }
});

// GET /api/khoas/export: Export toàn bộ khoa
router.get('/export', async (req, res) => {
    try {
        let sql = SELECT_KHOA_QUERY + ' GROUP BY k.maKhoa, k.tenKhoa ORDER BY k.maKhoa';
        const [rows] = await db.execute(sql);

        // Chuyển thành worksheet
        const wsData = rows.map(row => ({
            'Mã Khoa': row.maKhoa,
            'Tên Khoa': row.tenKhoa,
            'Số Sinh viên': row.soSinhVien || 0,
            'Số Giảng viên': row.soGiangVien || 0,
            'Số Môn học': row.soMonHoc || 0,
            'Số Lớp học': row.soLopHoc || 0
        }));

        const ws = XLSX.utils.json_to_sheet(wsData);

        // Thống kê chi tiết cho mỗi khoa
        const detailSheets = [];
        for (let row of rows) {
            // Lấy danh sách sinh viên
            const [students] = await db.execute(`
                SELECT maSV, hoTen, email, maLop
                FROM SinhVien
                WHERE maKhoa = ?
            `, [row.maKhoa]);

            if (students.length > 0) {
                const wsStudents = XLSX.utils.json_to_sheet(students.map(s => ({
                    'Mã SV': s.maSV,
                    'Họ tên': s.hoTen,
                    'Email': s.email || '',
                    'Lớp': s.maLop || ''
                })));
                detailSheets.push({ name: `SV_${row.maKhoa}`, sheet: wsStudents });
            }
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Danh sách Khoa');
        
        // Thêm các sheet chi tiết (tối đa 10 sheet để tránh file quá lớn)
        detailSheets.slice(0, 10).forEach(item => {
            XLSX.utils.book_append_sheet(wb, item.sheet, item.name);
        });

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=danh_sach_khoa.xlsx');
        res.send(buffer);
    } catch (err) {
        console.error('LỖI KHI EXPORT KHOA:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi export dữ liệu' });
    }
});

// GET /api/khoas/export-selected: Export khoa đã chọn
router.get('/export-selected', async (req, res) => {
    const { selected } = req.query;
    if (!selected) {
        return res.status(400).json({ message: 'Thiếu danh sách maKhoa đã chọn' });
    }

    const maKhoas = selected.split(',');
    let sql = `${SELECT_KHOA_QUERY} WHERE k.maKhoa IN (${maKhoas.map(() => '?').join(',')})`;
    sql += ' GROUP BY k.maKhoa, k.tenKhoa';

    try {
        const [rows] = await db.execute(sql, maKhoas);
        const wsData = rows.map(row => ({
            'Mã Khoa': row.maKhoa,
            'Tên Khoa': row.tenKhoa,
            'Số Sinh viên': row.soSinhVien || 0,
            'Số Giảng viên': row.soGiangVien || 0,
            'Số Môn học': row.soMonHoc || 0,
            'Số Lớp học': row.soLopHoc
        }));

        const ws = XLSX.utils.json_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Khoa đã chọn');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=khoa_da_chon_${new Date().toISOString().split('T')[0]}.xlsx`);
        res.send(buffer);
    } catch (err) {
        console.error('LỖI KHI EXPORT KHOA ĐÃ CHỌN:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi export dữ liệu' });
    }
});

// POST /api/khoas: Thêm Khoa
router.post('/', async (req, res) => {
    const { maKhoa, tenKhoa } = req.body;
    
    if (!maKhoa || !tenKhoa) { 
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc: Mã Khoa và Tên Khoa.' });
    }
    
    const sql = `
        INSERT INTO khoa (maKhoa, tenKhoa) 
        VALUES (?, ?)
    `;
    const params = [maKhoa, tenKhoa]; 

    try {
        await db.execute(sql, params);
        res.status(201).json({ message: 'Thêm khoa thành công' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Mã Khoa đã tồn tại!' });
        console.error('LỖI KHI THÊM KHOA:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi thêm dữ liệu' });
    }
});

// POST /api/khoas/import: Import từ Excel/CSV
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
            const maKhoa = row['Mã Khoa'] || row['maKhoa'];
            const tenKhoa = row['Tên Khoa'] || row['tenKhoa'];

            // Validation cơ bản
            if (!maKhoa || !tenKhoa) {
                errorRows.push({ row: row.__rowNum__ + 1, error: 'Thiếu thông tin bắt buộc (maKhoa, tenKhoa)' });
                continue;
            }

            // Kiểm tra duplicate maKhoa
            const [existingKhoa] = await conn.execute('SELECT maKhoa FROM Khoa WHERE maKhoa = ?', [maKhoa]);
            if (existingKhoa.length > 0) {
                errorRows.push({ row: row.__rowNum__ + 1, error: `Mã Khoa '${maKhoa}' đã tồn tại` });
                continue;
            }

            // Insert khoa
            try {
                await conn.execute(
                    `INSERT INTO Khoa (maKhoa, tenKhoa) VALUES (?, ?)`,
                    [maKhoa, tenKhoa]
                );
                successCount++;
            } catch (khoaErr) {
                errorRows.push({ row: row.__rowNum__ + 1, error: `Lỗi insert: ${khoaErr.message}` });
            }
        }

        await conn.release();

        let message = `Import thành công ${successCount}/${data.length} dòng.`;
        if (errorRows.length > 0) {
            message += ` Lỗi ở các dòng: ${JSON.stringify(errorRows.slice(0, 5))}... (tổng ${errorRows.length} lỗi)`;
        }
        res.json({ message });
    } catch (err) {
        console.error('LỖI KHI IMPORT KHOA:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi import dữ liệu' });
    }
});

// PUT /api/khoas/:maKhoa: Cập nhật Khoa
router.put('/:maKhoa', async (req, res) => {
    const { maKhoa } = req.params;
    const { tenKhoa } = req.body;
    
    if (!tenKhoa) {
        return res.status(400).json({ message: 'Thiếu Tên Khoa để cập nhật.' });
    }

    const sql = `
        UPDATE khoa SET tenKhoa = ? 
        WHERE maKhoa = ?
    `;
    const params = [tenKhoa, maKhoa];

    try {
        const [result] = await db.execute(sql, params);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Không tìm thấy khoa để cập nhật' });
        res.json({ message: 'Cập nhật khoa thành công' });
    } catch (err) {
        console.error('LỖI KHI CẬP NHẬT KHOA:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi cập nhật dữ liệu' });
    }
});

// DELETE /api/khoas/:maKhoa: Xóa Khoa
router.delete('/:maKhoa', async (req, res) => {
    const { maKhoa } = req.params;
    const sql = 'DELETE FROM khoa WHERE maKhoa = ?';
    
    try {
        const [result] = await db.execute(sql, [maKhoa]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Không tìm thấy khoa để xóa' });
        res.json({ message: 'Xóa khoa thành công' });
    } catch (err) {
        // Lỗi Foreign Key Constraint (Khoa đang liên kết với Sinh viên, Giảng viên, Lớp học)
        if (err.code === 'ER_ROW_IS_REFERENCED_2') { 
            return res.status(400).json({ message: 'Không thể xóa khoa này vì đang liên kết với Sinh viên, Giảng viên hoặc Lớp học.' });
        }
        console.error('LỖI KHI XÓA KHOA:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi xóa dữ liệu' });
    }
});

module.exports = router;