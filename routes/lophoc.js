// routes/lophoc.js - Backend API hoàn chỉnh cho Quản lý Lớp học (CẬP NHẬT FILTER maLop + maKhoa)
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ storage: multer.memoryStorage() });

// Query lấy dữ liệu Lớp học (JOIN với Khoa)
const SELECT_LOPHOC_QUERY = `
    SELECT 
        lh.maLop, lh.tenLop, 
        lh.maKhoa, k.tenKhoa,
        COUNT(DISTINCT sv.maSV) as soSinhVien
    FROM lophoc lh
    LEFT JOIN khoa k ON lh.maKhoa = k.maKhoa
    LEFT JOIN sinhvien sv ON lh.maLop = sv.maLop
`;

// ✅ GET /api/lophoc: Lấy tất cả lớp (có thể filter theo maKhoa hoặc maLop)
router.get('/', async (req, res) => {
    const { _q: query, maKhoa, maLop, page = 1, limit = 100 } = req.query;
    let sql = SELECT_LOPHOC_QUERY;
    let countSql = `SELECT COUNT(DISTINCT lh.maLop) as total FROM lophoc lh 
                    LEFT JOIN khoa k ON lh.maKhoa = k.maKhoa 
                    LEFT JOIN sinhvien sv ON lh.maLop = sv.maLop`;
    let params = [];
    let countParams = [];
    let conditions = [];

    if (query) {
        conditions.push('(lh.maLop LIKE ? OR lh.tenLop LIKE ? OR k.tenKhoa LIKE ?)');
        params.push(`%${query}%`, `%${query}%`, `%${query}%`);
        countParams.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }

    // ✅ Bổ sung filter theo maKhoa & maLop
    if (maKhoa) {
        conditions.push('lh.maKhoa = ?');
        params.push(maKhoa);
        countParams.push(maKhoa);
    }
    if (maLop) {
        conditions.push('lh.maLop = ?');
        params.push(maLop);
        countParams.push(maLop);
    }

    if (conditions.length > 0) {
        const whereClause = ' WHERE ' + conditions.join(' AND ');
        sql += whereClause;
        countSql += whereClause;
    }

    sql += ' GROUP BY lh.maLop, lh.tenLop, lh.maKhoa, k.tenKhoa ORDER BY lh.maLop';
    sql += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    try {
        const [countRows] = await db.execute(countSql, countParams);
        const total = countRows[0].total;
        const [rows] = await db.execute(sql, params);
        res.json({
            data: rows,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        console.error('LỖI KHI TẢI DANH SÁCH LỚP HỌC:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải dữ liệu', error: err.message });
    }
});

// GET /api/lophoc/khoa/:maKhoa: Lấy danh sách lớp của một khoa (cho dropdown)
router.get('/khoa/:maKhoa', async (req, res) => {
    const { maKhoa } = req.params;
    try {
        const [rows] = await db.execute(
            'SELECT maLop, tenLop FROM lophoc WHERE maKhoa = ? ORDER BY maLop',
            [maKhoa]
        );
        res.json(rows);
    } catch (err) {
        console.error('Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// GET /api/lophoc/stats: Lấy thống kê tổng quan
router.get('/stats', async (req, res) => {
    try {
        // 1. Tổng số lớp
        const [totalRows] = await db.execute('SELECT COUNT(*) as total FROM lophoc');
        const totalClasses = totalRows[0].total;

        // 2. Tổng số sinh viên
        const [studentRows] = await db.execute('SELECT COUNT(*) as total FROM sinhvien');
        const totalStudents = studentRows[0].total;

        // 3. Lớp có sinh viên nhiều nhất
        const [maxClassRows] = await db.execute(`
            SELECT lh.tenLop, COUNT(sv.maSV) as soSV
            FROM lophoc lh
            LEFT JOIN sinhvien sv ON lh.maLop = sv.maLop
            GROUP BY lh.maLop, lh.tenLop
            ORDER BY soSV DESC
            LIMIT 1
        `);
        const maxClass = maxClassRows[0] ? `${maxClassRows[0].tenLop} (${maxClassRows[0].soSV} SV)` : 'N/A';

        // 4. Trung bình sinh viên/lớp
        const [avgRows] = await db.execute(`
            SELECT AVG(siso) as avg FROM (
                SELECT COUNT(sv.maSV) as siso
                FROM lophoc lh
                LEFT JOIN sinhvien sv ON lh.maLop = sv.maLop
                GROUP BY lh.maLop
            ) as counts
        `);
        const avgStudents = avgRows[0].avg ? Math.round(avgRows[0].avg) : 0;

        // 5. Phân bố lớp học theo khoa
        const [byKhoaRows] = await db.execute(`
            SELECT k.maKhoa, k.tenKhoa, COUNT(lh.maLop) as soLuong
            FROM khoa k
            LEFT JOIN lophoc lh ON k.maKhoa = lh.maKhoa
            GROUP BY k.maKhoa, k.tenKhoa
            ORDER BY soLuong DESC
        `);

        // 6. Phân bố sinh viên theo lớp (top 5)
        const [bySinhVienRows] = await db.execute(`
            SELECT lh.maLop, lh.tenLop, COUNT(sv.maSV) as soSV
            FROM lophoc lh
            LEFT JOIN sinhvien sv ON lh.maLop = sv.maLop
            GROUP BY lh.maLop, lh.tenLop
            ORDER BY soSV DESC
            LIMIT 5
        `);

        res.json({
            totalClasses,
            totalStudents,
            maxClass,
            avgStudents,
            byKhoa: byKhoaRows,
            bySinhVien: bySinhVienRows
        });
    } catch (err) {
        console.error('LỖI KHI TẢI THỐNG KÊ:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải thống kê' });
    }
});

// GET /api/lophoc/:maLop/details: Xem chi tiết lớp học
router.get('/:maLop/details', async (req, res) => {
    const { maLop } = req.params;
    try {
        // Thông tin cơ bản
        const [basicInfo] = await db.execute(`
            SELECT lh.*, k.tenKhoa
            FROM lophoc lh
            LEFT JOIN khoa k ON lh.maKhoa = k.maKhoa
            WHERE lh.maLop = ?
        `, [maLop]);

        if (basicInfo.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        }

        // Danh sách sinh viên
        const [students] = await db.execute(`
            SELECT maSV, hoTen, email, trangThai
            FROM sinhvien
            WHERE maLop = ?
            ORDER BY maSV
        `, [maLop]);

        // Số lượng sinh viên
        const studentCount = students.length;

        // Điểm trung bình của lớp
        const [avgScore] = await db.execute(`
            SELECT AVG(d.diemTK) as diemTB
            FROM diem d
            JOIN sinhvien sv ON d.maSV = sv.maSV
            WHERE sv.maLop = ? AND d.diemTK IS NOT NULL
        `, [maLop]);

        // Danh sách môn học của lớp
        const [courses] = await db.execute(`
            SELECT lmg.maMH, mh.tenMH, lmg.maGV, gv.hoTen as tenGV, lmg.hocKy
            FROM lop_mh_gv lmg
            JOIN monhoc mh ON lmg.maMH = mh.maMH
            LEFT JOIN giangvien gv ON lmg.maGV = gv.maGV
            WHERE lmg.maLop = ?
        `, [maLop]);

        res.json({
            info: basicInfo[0],
            students,
            studentCount,
            avgScore: avgScore[0].diemTB ? parseFloat(avgScore[0].diemTB).toFixed(2) : null,
            courses
        });
    } catch (err) {
        console.error('LỖI KHI TẢI CHI TIẾT LỚP HỌC:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải chi tiết' });
    }
});

// POST /api/lophoc: Thêm Lớp học
router.post('/', async (req, res) => {
    const { maLop, tenLop, maKhoa } = req.body;
    
    if (!maLop || !tenLop || !maKhoa) { 
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc: Mã Lớp, Tên Lớp, hoặc Mã Khoa.' });
    }
    
    const sql = `
        INSERT INTO lophoc (maLop, tenLop, maKhoa) 
        VALUES (?, ?, ?)
    `;
    const params = [maLop, tenLop, maKhoa]; 

    try {
        await db.execute(sql, params);
        res.status(201).json({ message: 'Thêm lớp học thành công' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Mã Lớp đã tồn tại!' });
        if (err.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({ message: 'Mã Khoa không hợp lệ.' });
        }
        console.error('LỖI KHI THÊM LỚP HỌC:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi thêm dữ liệu' });
    }
});

// POST /api/lophoc/import: Import từ Excel
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
            const tenLop = row['Tên Lớp'] || row['tenLop'];
            const maKhoa = row['Mã Khoa'] || row['maKhoa'];
            
            if (!maLop || !tenLop || !maKhoa) {
                errorRows.push({ row: i + 2, error: 'Thiếu thông tin bắt buộc' });
                continue;
            }
            
            // Kiểm tra duplicate
            const [existingLop] = await conn.execute('SELECT maLop FROM lophoc WHERE maLop = ?', [maLop]);
            if (existingLop.length > 0) {
                errorRows.push({ row: i + 2, error: `Mã Lớp '${maLop}' đã tồn tại` });
                continue;
            }
            
            // Kiểm tra maKhoa
            const [existingKhoa] = await conn.execute('SELECT maKhoa FROM khoa WHERE maKhoa = ?', [maKhoa]);
            if (existingKhoa.length === 0) {
                errorRows.push({ row: i + 2, error: `Mã Khoa '${maKhoa}' không tồn tại` });
                continue;
            }
            
            try {
                await conn.execute(
                    `INSERT INTO lophoc (maLop, tenLop, maKhoa) VALUES (?, ?, ?)`,
                    [maLop, tenLop, maKhoa]
                );
                successCount++;
            } catch (lopErr) {
                errorRows.push({ row: i + 2, error: `Lỗi insert: ${lopErr.message}` });
            }
        }
        
        await conn.release();
        
        let message = `Import thành công ${successCount}/${data.length} dòng.`;
        if (errorRows.length > 0) {
            message += ` Lỗi ở các dòng: ${JSON.stringify(errorRows.slice(0, 5))}... (tổng ${errorRows.length} lỗi)`;
        }
        res.json({ message });
        
    } catch (err) {
        console.error('LỖI KHI IMPORT LỚP HỌC:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi import dữ liệu' });
    }
});

// GET /api/lophoc/export: Export ra Excel
router.get('/export', async (req, res) => {
    try {
        const [rows] = await db.execute(SELECT_LOPHOC_QUERY + ' GROUP BY lh.maLop, lh.tenLop, lh.maKhoa, k.tenKhoa ORDER BY lh.maLop');
        
        const wsData = rows.map(row => ({
            'Mã Lớp': row.maLop,
            'Tên Lớp': row.tenLop,
            'Mã Khoa': row.maKhoa,
            'Tên Khoa': row.tenKhoa || '',
            'Số Sinh viên': row.soSinhVien || 0
        }));
        
        const ws = XLSX.utils.json_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Danh sách lớp học');
        
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=danh_sach_lop_hoc.xlsx');
        res.send(buffer);
        
    } catch (err) {
        console.error('LỖI KHI EXPORT LỚP HỌC:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi export dữ liệu' });
    }
});

// PUT /api/lophoc/:maLop: Cập nhật Lớp học
router.put('/:maLop', async (req, res) => {
    const { maLop } = req.params;
    const { tenLop, maKhoa } = req.body;
    
    if (!tenLop || !maKhoa) {
        return res.status(400).json({ message: 'Thiếu Tên Lớp hoặc Mã Khoa để cập nhật.' });
    }

    const sql = `
        UPDATE lophoc SET tenLop = ?, maKhoa = ?
        WHERE maLop = ?
    `;
    const params = [tenLop, maKhoa, maLop];

    try {
        const [result] = await db.execute(sql, params);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Không tìm thấy lớp học để cập nhật' });
        res.json({ message: 'Cập nhật lớp học thành công' });
    } catch (err) {
        if (err.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({ message: 'Mã Khoa không hợp lệ.' });
        }
        console.error('LỖI KHI CẬP NHẬT LỚP HỌC:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi cập nhật dữ liệu' });
    }
});

// DELETE /api/lophoc/:maLop: Xóa Lớp học
router.delete('/:maLop', async (req, res) => {
    const { maLop } = req.params;
    const sql = 'DELETE FROM lophoc WHERE maLop = ?';
    
    try {
        const [result] = await db.execute(sql, [maLop]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Không tìm thấy lớp học để xóa' });
        res.json({ message: 'Xóa lớp học thành công' });
    } catch (err) {
        if (err.code === 'ER_ROW_IS_REFERENCED_2') { 
            return res.status(400).json({ message: 'Không thể xóa lớp học này vì đang liên kết với Sinh viên hoặc các Môn học/Giảng viên.' });
        }
        console.error('LỖI KHI XÓA LỚP HỌC:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi xóa dữ liệu' });
    }
});

module.exports = router;