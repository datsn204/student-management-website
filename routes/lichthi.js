// routes/lichthi.js - API quản lý lịch thi (đầy đủ chức năng)

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ storage: multer.memoryStorage() });

// ===== QUERY CONSTANTS =====
const SELECT_LICHTHI_QUERY = `
    SELECT 
    lt.maLT, lt.maMH, m.tenMH, lt.maLop, lh.tenLop,
    lh.maKhoa, k.tenKhoa,
    lt.ngayThi, lt.phongThi, lt.ghiChu
    FROM lichthi lt
    LEFT JOIN monhoc m ON lt.maMH = m.maMH
    LEFT JOIN lophoc lh ON lt.maLop = lh.maLop
    LEFT JOIN khoa k ON lh.maKhoa = k.maKhoa
`;

const STATS_LICHTHI_QUERY = `
    SELECT 
        'Tổng số lịch thi' as label,
        COUNT(*) as value
    FROM lichthi
    UNION ALL
    SELECT 'Lịch thi sắp tới (7 ngày)', COUNT(*)
    FROM lichthi 
    WHERE ngayThi BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)
    UNION ALL
    SELECT 'Số môn học có thi', COUNT(DISTINCT maMH)
    FROM lichthi
    UNION ALL
    SELECT 'Số phòng thi được dùng', COUNT(DISTINCT phongThi)
    FROM lichthi
`;

// ===== GET ENDPOINTS =====

// GET: Thống kê lịch thi (Dashboard)
router.get('/stats', async (req, res) => {
    try {
        const [totalRows] = await db.execute('SELECT COUNT(*) as total FROM lichthi');
        const totalLichThi = totalRows[0].total;

        const [upcomingRows] = await db.execute(`
            SELECT COUNT(*) as total FROM lichthi 
            WHERE ngayThi BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)
        `);
        const upcomingLichThi = upcomingRows[0].total;

        const [monhocRows] = await db.execute('SELECT COUNT(DISTINCT maMH) as total FROM lichthi');
        const totalMonHoc = monhocRows[0].total;

        const [phongRows] = await db.execute('SELECT COUNT(DISTINCT phongThi) as total FROM lichthi');
        const totalPhong = phongRows[0].total;

        const [byMonhocRows] = await db.execute(`
            SELECT m.maMH, m.tenMH, COUNT(lt.maLT) as soLuong
            FROM monhoc m
            LEFT JOIN lichthi lt ON m.maMH = lt.maMH
            GROUP BY m.maMH, m.tenMH
            ORDER BY soLuong DESC
        `);

        const [byMonthRows] = await db.execute(`
            SELECT MONTH(ngayThi) as thang, YEAR(ngayThi) as nam, COUNT(*) as soLuong
            FROM lichthi
            WHERE ngayThi IS NOT NULL
            GROUP BY YEAR(ngayThi), MONTH(ngayThi)
            ORDER BY nam DESC, thang DESC
        `);

        res.json({
            totalLichThi,
            upcomingLichThi,
            totalMonHoc,
            totalPhong,
            byMonhoc: byMonhocRows,
            byMonth: byMonthRows
        });
    } catch (err) {
        console.error('Lỗi stats:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

router.get('/:maLT/details', async (req, res) => {
    const { maLT } = req.params;
    try {
        const [ltRows] = await db.execute(`
    SELECT 
        lt.maLT, lt.maMH, m.tenMH, m.soTinChi,
        lt.maLop, lh.tenLop,
        lh.maKhoa, k.tenKhoa,
        lt.ngayThi, lt.phongThi, lt.ghiChu,
        MONTH(lt.ngayThi) as thang,
        YEAR(lt.ngayThi) as nam
    FROM lichthi lt
    LEFT JOIN monhoc m ON lt.maMH = m.maMH
    LEFT JOIN lophoc lh ON lt.maLop = lh.maLop
    LEFT JOIN khoa k ON lh.maKhoa = k.maKhoa
    WHERE lt.maLT = ?
`, [maLT]);

        if (ltRows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy lịch thi' });
        }

        res.json(ltRows[0]);
    } catch (err) {
        console.error('Lỗi chi tiết LT:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải chi tiết' });
    }
});

// Thay thế router.get('/') trong lichthi.js

router.get('/', async (req, res) => {
    const { _q: query, page = 1, limit = 10, maMH, maLop, maKhoa, thang } = req.query;
    let sql = SELECT_LICHTHI_QUERY;
    let countSql = `SELECT COUNT(*) as total FROM lichthi lt 
        LEFT JOIN monhoc m ON lt.maMH = m.maMH 
        LEFT JOIN lophoc lh ON lt.maLop = lh.maLop 
        LEFT JOIN khoa k ON lh.maKhoa = k.maKhoa`;
    let params = [];
    let countParams = [];

    let whereClause = '';
    if (query || maMH || maLop || maKhoa || thang) {
        whereClause = ' WHERE ';
        let conditions = [];

        if (query) {
            conditions.push('(lt.maLT LIKE ? OR lt.maMH LIKE ? OR m.tenMH LIKE ? OR lt.phongThi LIKE ? OR lt.maLop LIKE ? OR lh.tenLop LIKE ?)');
            const searchParam = `%${query}%`;
            for (let i = 0; i < 6; i++) {
                params.push(searchParam);
                countParams.push(searchParam);
            }
        }

        if (maKhoa) {
            conditions.push('lh.maKhoa = ?');
            params.push(maKhoa);
            countParams.push(maKhoa);
        }

        if (maMH) {
            conditions.push('lt.maMH = ?');
            params.push(maMH);
            countParams.push(maMH);
        }

        if (maLop) {
            conditions.push('lt.maLop = ?');
            params.push(maLop);
            countParams.push(maLop);
        }

        if (thang) {
            conditions.push('MONTH(lt.ngayThi) = ?');
            params.push(parseInt(thang));
            countParams.push(parseInt(thang));
        }

        whereClause += conditions.join(' AND ');
        sql += whereClause;
        countSql += whereClause;
    }

    sql += ' ORDER BY lt.ngayThi DESC LIMIT ? OFFSET ?';
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
        console.error('Lỗi danh sách LT:', err.message, err);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải dữ liệu: ' + err.message });
    }
});

// ✅ API 2: Lấy Môn theo Khoa (ĐÃ CÓ - dòng ~180)
router.get('/monhoc-by-khoa/:maKhoa', async (req, res) => {
    const { maKhoa } = req.params;
    try {
        const [rows] = await db.execute(`
            SELECT DISTINCT m.maMH, m.tenMH
            FROM monhoc m
            WHERE m.maKhoa = ?
            ORDER BY m.maMH
        `, [maKhoa]);
        
        res.json(rows);
    } catch (err) {
        console.error('Lỗi lấy môn học theo khoa:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// ✅ KIỂM TRA có đoạn này không (dòng ~180)
router.get('/monhoc-by-khoa/:maKhoa', async (req, res) => {
    const { maKhoa } = req.params;
    try {
        const [rows] = await db.execute(`
            SELECT DISTINCT m.maMH, m.tenMH
            FROM monhoc m
            WHERE m.maKhoa = ?
            ORDER BY m.maMH
        `, [maKhoa]);

        res.json(rows);
    } catch (err) {
        console.error('Lỗi lấy môn học theo khoa:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// ✅ API 1: Lấy Lớp theo Khoa (ĐÃ CÓ - dòng ~200)
router.get('/lophoc-by-khoa/:maKhoa', async (req, res) => {
    const { maKhoa } = req.params;
    try {
        const [rows] = await db.execute(`
            SELECT maLop, tenLop
            FROM lophoc
            WHERE maKhoa = ?
            ORDER BY maLop
        `, [maKhoa]);

        res.json(rows);
    } catch (err) {
        console.error('Lỗi lấy lớp học theo khoa:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

router.get('/export', async (req, res) => {
    try {
        const [rows] = await db.execute(`
    SELECT 
        lt.maLT, lt.maMH, m.tenMH, 
        lt.maLop, lh.tenLop,
        lh.maKhoa, k.tenKhoa,
        lt.ngayThi, lt.phongThi, lt.ghiChu
    FROM lichthi lt
    LEFT JOIN monhoc m ON lt.maMH = m.maMH
    LEFT JOIN lophoc lh ON lt.maLop = lh.maLop
    LEFT JOIN khoa k ON lh.maKhoa = k.maKhoa
    ORDER BY lt.ngayThi DESC
`);

        const wsData = rows.map(row => ({
            'Mã LT': row.maLT,
            'Mã Khoa': row.maKhoa || '',
            'Tên Khoa': row.tenKhoa || '',
            'Mã Lớp': row.maLop || '',
            'Tên Lớp': row.tenLop || '',
            'Mã MH': row.maMH,
            'Tên Môn Học': row.tenMH || '',
            'Ngày Thi': row.ngayThi ? new Date(row.ngayThi).toLocaleString('vi-VN') : '',
            'Phòng Thi': row.phongThi || '',
            'Ghi Chú': row.ghiChu || ''
        }));

        const ws = XLSX.utils.json_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Lịch Thi');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=lich_thi_' + new Date().toISOString().split('T')[0] + '.xlsx');
        res.send(buffer);
    } catch (err) {
        console.error('Lỗi export:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi export' });
    }
});

router.get('/export-selected', async (req, res) => {
    const { selected } = req.query;
    if (!selected) {
        return res.status(400).json({ message: 'Thiếu danh sách maLT' });
    }

    const maLTs = selected.split(',');
    let sql = `
    SELECT 
        lt.maLT, lt.maMH, m.tenMH, 
        lt.maLop, lh.tenLop,
        lh.maKhoa, k.tenKhoa,
        lt.ngayThi, lt.phongThi, lt.ghiChu
    FROM lichthi lt
    LEFT JOIN monhoc m ON lt.maMH = m.maMH
    LEFT JOIN lophoc lh ON lt.maLop = lh.maLop
    LEFT JOIN khoa k ON lh.maKhoa = k.maKhoa
    WHERE lt.maLT IN (${maLTs.map(() => '?').join(',')})
`;

    try {
        const [rows] = await db.execute(sql, maLTs);

        const wsData = rows.map(row => ({
            'Mã LT': row.maLT,
            'Mã Khoa': row.maKhoa || '',
            'Tên Khoa': row.tenKhoa || '',
            'Mã Lớp': row.maLop || '',
            'Tên Lớp': row.tenLop || '',
            'Mã MH': row.maMH,
            'Tên Môn Học': row.tenMH || '',
            'Ngày Thi': row.ngayThi ? new Date(row.ngayThi).toLocaleString('vi-VN') : '',
            'Phòng Thi': row.phongThi || '',
            'Ghi Chú': row.ghiChu || ''
        }));

        const ws = XLSX.utils.json_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Lịch Thi Đã Chọn');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=lich_thi_${new Date().toISOString().split('T')[0]}.xlsx`);
        res.send(buffer);
    } catch (err) {
        console.error('Lỗi export selected:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// POST: Thêm lịch thi
router.post('/', async (req, res) => {
    const { maLT, maMH, maLop, ngayThi, phongThi, ghiChu } = req.body;

    if (!maLT || !maMH || !maLop || !ngayThi || !phongThi) {
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // ✅ Kiểm tra maLT tồn tại
        const [existingLT] = await conn.execute('SELECT maLT FROM lichthi WHERE maLT = ?', [maLT]);
        if (existingLT.length > 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Mã LT đã tồn tại' });
        }

        // ✅ Kiểm tra maLop tồn tại
        const [existingLop] = await conn.execute('SELECT maLop FROM lophoc WHERE maLop = ?', [maLop]);
        if (existingLop.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Mã Lớp không hợp lệ' });
        }

        // ✅ Kiểm tra maMH tồn tại
        const [existingMH] = await conn.execute('SELECT maMH FROM monhoc WHERE maMH = ?', [maMH]);
        if (existingMH.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Mã MH không hợp lệ' });
        }

        // ✅ Kiểm tra Lớp và Môn có cùng Khoa không
        const [khoaCheck] = await conn.execute(`
            SELECT l.maKhoa as lopKhoa, m.maKhoa as monKhoa
            FROM lophoc l, monhoc m
            WHERE l.maLop = ? AND m.maMH = ?
        `, [maLop, maMH]);

        if (khoaCheck.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Lỗi dữ liệu' });
        }

        if (khoaCheck[0].lopKhoa !== khoaCheck[0].monKhoa) {
            await conn.rollback();
            return res.status(400).json({ message: 'Lớp và Môn học không cùng Khoa' });
        }

        // ✅ Insert lịch thi
        await conn.execute(
            `INSERT INTO lichthi (maLT, maLop, maMH, ngayThi, phongThi, ghiChu) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [maLT, maLop, maMH, ngayThi, phongThi, ghiChu || null]
        );

        await conn.commit();
        res.status(201).json({ message: 'Thêm lịch thi thành công' });

    } catch (err) {
        await conn.rollback();

        if (err.sqlState === '45000') {
            return res.status(400).json({ message: err.message });
        }

        console.error('Lỗi thêm lịch thi:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ: ' + err.message });
    } finally {
        conn.release();
    }
});

// POST: Import lịch thi từ Excel
router.post('/import', upload.single('excelFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Không có file upload' });
    }

    try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet);

        if (data.length === 0) {
            return res.status(400).json({ message: 'File không có dữ liệu' });
        }

        const conn = await db.getConnection();
        let successCount = 0;
        let errorRows = [];

        for (let row of data) {
            const { maLT, maLop, maMH, ngayThi, phongThi, ghiChu } = row;

            if (!maLT || !maLop || !maMH || !ngayThi || !phongThi) {
                errorRows.push({ row: row.__rowNum__ + 1, error: 'Thiếu thông tin bắt buộc' });
                continue;
            }

            // Kiểm tra maLT tồn tại
            const [existingLT] = await conn.execute('SELECT maLT FROM lichthi WHERE maLT = ?', [maLT]);
            if (existingLT.length > 0) {
                errorRows.push({ row: row.__rowNum__ + 1, error: `Mã LT '${maLT}' đã tồn tại` });
                continue;
            }

            // Kiểm tra maLop tồn tại
            const [existingLop] = await conn.execute('SELECT maLop FROM lophoc WHERE maLop = ?', [maLop]);
            if (existingLop.length === 0) {
                errorRows.push({ row: row.__rowNum__ + 1, error: `Mã Lớp '${maLop}' không tồn tại` });
                continue;
            }

            // Kiểm tra maMH tồn tại
            const [existingMH] = await conn.execute('SELECT maMH FROM monhoc WHERE maMH = ?', [maMH]);
            if (existingMH.length === 0) {
                errorRows.push({ row: row.__rowNum__ + 1, error: `Mã MH '${maMH}' không tồn tại` });
                continue;
            }

            // Kiểm tra phân công
            const [existingPhanCong] = await conn.execute(`
                SELECT id FROM lop_mh_gv 
                WHERE maLop = ? AND maMH = ?
            `, [maLop, maMH]);
            if (existingPhanCong.length === 0) {
                errorRows.push({ row: row.__rowNum__ + 1, error: `Lớp '${maLop}' không học môn '${maMH}'` });
                continue;
            }

            try {
                await conn.execute(
                    `INSERT INTO lichthi (maLT, maLop, maMH, ngayThi, phongThi, ghiChu) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [maLT, maLop, maMH, ngayThi, phongThi, ghiChu || null]
                );
                successCount++;
            } catch (insertErr) {
                errorRows.push({ row: row.__rowNum__ + 1, error: 'Lỗi insert' });
            }
        }

        await conn.release();

        let message = `Import thành công ${successCount}/${data.length} dòng.`;
        if (errorRows.length > 0) {
            message += ` Lỗi: ${errorRows.length} dòng`;
        }
        res.json({ message, errors: errorRows });

    } catch (err) {
        console.error('Lỗi import:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});
// ===== PUT & DELETE =====

// Thay thế router.put('/:maLT') trong lichthi.js

router.put('/:maLT', async (req, res) => {
    const { maLT } = req.params;
    const { ngayThi, phongThi, ghiChu } = req.body;

    // ✅ CHỈ YÊU CẦU NGÀY THI VÀ PHÒNG THI (không cho sửa lớp, môn)
    if (!ngayThi || !phongThi) {
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
    }

    try {
        // ✅ CHỈ UPDATE NGÀY THI, PHÒNG THI, GHI CHÚ
        const sql = `
            UPDATE lichthi SET 
                ngayThi = ?, phongThi = ?, ghiChu = ? 
            WHERE maLT = ?
        `;

        const [result] = await db.execute(sql, [ngayThi, phongThi, ghiChu || null, maLT]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy lịch thi' });
        }

        res.json({ message: 'Cập nhật thành công' });

    } catch (err) {
        console.error('Lỗi update:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ: ' + err.message });
    }
});

// DELETE: Xóa lịch thi
router.delete('/:maLT', async (req, res) => {
    const { maLT } = req.params;

    try {
        const [result] = await db.execute('DELETE FROM lichthi WHERE maLT = ?', [maLT]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy lịch thi' });
        }
        res.json({ message: 'Xóa thành công' });
    } catch (err) {
        console.error('Lỗi delete:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

module.exports = router;